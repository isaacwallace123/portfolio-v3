import { guardInventory, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/learning/certificates/{certificateId} — public verification.
//
// Public on purpose: a certificate that only its holder can view verifies nothing. The identifier
// is opaque, random, and unguessable, and the response says what the certificate says — course,
// version, issue date, skills, and the name on it — and nothing about the account behind it.
//
// Throttled on the edge-supplied client address rather than session-gated, so the link works for
// someone who has never signed in while a scraper cannot walk the identifier space for free.
export const dynamic = "force-dynamic";

const CERTIFICATE_ID = /^hoc-[0-9a-f]{32}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ certificateId: string }> },
) {
  const { certificateId } = await params;
  if (!CERTIFICATE_ID.test(certificateId))
    return jsonNoStore({ error: "No such certificate." }, 404);

  const denied = guardInventory(req);
  if (denied) return denied;

  const res = await liveFetch(`/v1/learning/certificates/${certificateId}`);
  return jsonNoStore(
    await res.json().catch(() => ({})),
    res.ok ? 200 : res.status,
  );
}
