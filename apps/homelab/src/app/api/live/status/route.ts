import { NextResponse } from "next/server";
import { liveEnabled } from "@/shared/lib/liveApi";

// GET /api/live/status — whether live provisioning against the real cluster is configured.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { enabled: liveEnabled(), scenarioId: "checkout-traffic-spike" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
