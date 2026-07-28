import "server-only";
import { createHash } from "node:crypto";

// Server-side session verification for the practice-cluster control plane.
//
// Provisioning real infrastructure is not anonymous: every mutating /api/live route resolves the
// caller's identity by replaying their SSO cookie against the auth service. The browser can't forge
// this — the cookie is HttpOnly and signed by auth's Data Protection keyring, and the check happens
// on the server, never in the client bundle.

// In-cluster service URL in production; the public host is the dev/default fallback.
const AUTH_BASE =
  process.env.HOMELAB_AUTH_URL ??
  process.env.NEXT_PUBLIC_AUTH_API_URL ??
  "https://auth.isaacwallace.dev";

export interface CallerIdentity {
  /** Opaque, stable per-user key. Never the raw account id — see ownerKey(). */
  owner: string;
  displayName: string;
  isAdmin: boolean;
}

// Clusters are labelled with a hash of the account id rather than the id itself, so a cluster object
// on the platform carries no account identifier that could be correlated back to a person.
function ownerKey(userId: string): string {
  return createHash("sha256")
    .update(`homeops:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Resolve the signed-in caller, or null when the request carries no valid session.
 * Fails closed: any auth error, timeout, or malformed response is treated as "not signed in".
 */
export async function getCaller(req: Request): Promise<CallerIdentity | null> {
  const cookie = req.headers.get("cookie");
  if (!cookie || !cookie.includes("iw_session")) return null;

  try {
    const res = await fetch(`${AUTH_BASE}/auth/me`, {
      headers: { cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      id?: string;
      displayName?: string;
      roles?: string[];
    };
    if (!user?.id) return null;
    return {
      owner: ownerKey(user.id),
      displayName: user.displayName ?? "operator",
      isAdmin: (user.roles ?? []).includes("admin"),
    };
  } catch {
    return null;
  }
}

// Run ids are broker-issued and always match this shape. Every route validates the path parameter
// before it is interpolated into an upstream URL, so a crafted id can never reach another endpoint.
const RUN_ID = /^run-hl-[a-z0-9]{6,32}$/;

export function isValidRunId(runId: string): boolean {
  return RUN_ID.test(runId);
}
