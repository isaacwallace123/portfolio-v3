import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";

// POST /api/live/runs — provision a real run on the homelab cluster. Body: { scenarioId }.
// Forwards to the real API's POST /v1/runs with the server-side runs:write key.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!liveEnabled()) {
    return NextResponse.json(
      { error: "Live provisioning is not configured." },
      { status: 503 },
    );
  }

  let body: { scenarioId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const scenarioId = String(body.scenarioId ?? "checkout-traffic-spike");
  const res = await liveFetch("/v1/runs", {
    method: "POST",
    body: JSON.stringify({ scenarioId }),
  });

  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
