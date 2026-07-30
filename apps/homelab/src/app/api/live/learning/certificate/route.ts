import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET  /api/live/learning/certificate — the caller's certificate, if one has been issued.
// POST /api/live/learning/certificate — ask for it to be issued.
//
// The POST carries no claim of eligibility. Every requirement is re-checked upstream against
// persisted progress rows, and a refusal comes back as a 409 listing what is outstanding — which is
// what the page shows. A certificate the browser could talk its way into is not a certificate.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await guard(req, { kind: "read" });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    "/v1/learning/certificate",
    undefined,
    g.caller.owner,
  );
  return jsonNoStore(
    await res.json().catch(() => ({})),
    res.ok ? 200 : res.status,
  );
}

export async function POST(req: Request) {
  const g = await guard(req);
  if (!g.ok) return g.response;

  const body = await req.json().catch(() => ({}));

  const res = await liveFetch(
    "/v1/learning/certificate",
    { method: "POST", body: JSON.stringify(body) },
    g.caller.owner,
    // The name printed on the certificate, resolved from the verified session server-side. The
    // browser cannot supply it, so nobody can be issued a certificate in someone else's name.
    g.caller.displayName,
  );
  return jsonNoStore(
    await res.json().catch(() => ({})),
    res.ok ? 200 : res.status,
  );
}
