import { NextResponse } from "next/server";
import { getRunEngine } from "@/shared/lib/runEngine";

// GET /api/v1/scenarios — public scenario metadata and current capacity.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getRunEngine().listScenarios(), {
    headers: { "Cache-Control": "no-store" },
  });
}
