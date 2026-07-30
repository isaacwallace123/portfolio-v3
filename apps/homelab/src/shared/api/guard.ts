import "server-only";
import { NextResponse } from "next/server";
import {
  getCaller,
  isValidRunId,
  type CallerIdentity,
} from "@/shared/api/session";
import { liveEnabled } from "@/shared/api/live-server";

// Shared guard for every /api/live route that touches a practice cluster.
//
// Layers, in order: live control must be configured, the caller must be signed in, the run id must
// be well-formed, and the caller must be inside their rate budget. Ownership itself is enforced
// upstream by the API (which stores the owner on the cluster), so a caller cannot act on someone
// else's cluster even if they guess its id.

// Fixed-window budgets per user. Provisioning is the expensive, abusable action; ordinary control
// actions are cheap but still bounded. Deliberately small — this is a public demo on real hardware.
const LIMITS = {
  provision: { max: 5, windowMs: 60 * 60_000 }, // 5 clusters per hour
  action: { max: 120, windowMs: 60_000 }, // 120 control actions per minute
  read: { max: 60, windowMs: 60_000 }, // 60 public reads per minute
  // Inventory reads look cheap from here and are not: each one fans out upstream into a
  // cluster-wide Kubernetes sweep (nodes, every workload in every namespace, pod and node metrics,
  // GitOps applications). The pages that use them poll on a 15s timer, so 40/min is many times
  // more than any honest client needs and still refuses to be a load generator.
  inventory: { max: 40, windowMs: 60_000 },
} as const;

type Bucket = { count: number; resetAt: number };
// Process-local; each replica enforces its own share. The authoritative caps (one cluster per user,
// global concurrency) live in the API, so this layer is throttling, not the security boundary.
const buckets = new Map<string, Bucket>();

function rateLimit(key: string, kind: keyof typeof LIMITS): boolean {
  const { max, windowMs } = LIMITS[kind];
  const now = Date.now();
  const id = `${kind}:${key}`;
  const bucket = buckets.get(id);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    // Opportunistic cleanup so the map can't grow without bound.
    if (buckets.size > 5000)
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export type GuardResult =
  { ok: true; caller: CallerIdentity } | { ok: false; response: NextResponse };

/** Same, for a read anyone may make — the caller is who they are if they happen to be signed in. */
export type PublicGuardResult =
  | { ok: true; caller: CallerIdentity | null }
  | { ok: false; response: NextResponse };

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function deny(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function guard(
  req: Request,
  opts: { runId?: string; kind?: keyof typeof LIMITS } = {},
): Promise<GuardResult> {
  if (!liveEnabled())
    return {
      ok: false,
      response: deny(503, "Live control is not configured."),
    };

  const caller = await getCaller(req);
  if (!caller)
    return {
      ok: false,
      response: deny(401, "Sign in to use the practice cluster."),
    };

  if (opts.runId !== undefined && !isValidRunId(opts.runId))
    return { ok: false, response: deny(400, "Malformed run id.") };

  const kind = opts.kind ?? "action";
  if (!rateLimit(caller.owner, kind))
    return {
      ok: false,
      response: deny(
        429,
        kind === "provision"
          ? "You have provisioned too many clusters recently. Try again later."
          : "Too many actions. Slow down for a moment.",
      ),
    };

  return { ok: true, caller };
}

/** Rate-limit key for a caller with no session: the edge-supplied client address, falling back to
 *  one shared bucket. This layer is throttling rather than a boundary, so a coarse key is fine. */
function anonymousKey(req: Request): string {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `anon:${ip || "unknown"}`;
}

/**
 * Guard for public reads. The ranked board is something you look at, not something you do — it is
 * published to anyone, and a session only decides whether a row can be marked as yours. Signing in
 * is required to *touch* a cluster, which is what guard() above is for.
 */
export async function guardPublic(req: Request): Promise<PublicGuardResult> {
  if (!liveEnabled())
    return {
      ok: false,
      response: deny(503, "Live control is not configured."),
    };

  const caller = await getCaller(req);
  if (!rateLimit(caller?.owner ?? anonymousKey(req), "read"))
    return {
      ok: false,
      response: deny(429, "Too many requests. Try again in a moment."),
    };

  return { ok: true, caller };
}

/**
 * Guard for the sanitized inventory reads — platform, overview, topology, status.
 *
 * These describe the platform rather than a person, so they need no identity and deliberately skip
 * the auth round trip. What they do need is a ceiling: every one of them costs a real cluster-wide
 * Kubernetes read upstream, so left open they turn a `curl` loop into sustained load against the
 * live API server. Throttled on the edge-supplied client address, which behind Cloudflare is the
 * closest thing to a caller this surface has.
 */
export function guardInventory(req: Request): NextResponse | null {
  if (!liveEnabled()) return deny(503, "Live inventory is not configured.");
  if (!rateLimit(anonymousKey(req), "inventory"))
    return deny(429, "Too many requests. Try again in a moment.");
  return null;
}

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
