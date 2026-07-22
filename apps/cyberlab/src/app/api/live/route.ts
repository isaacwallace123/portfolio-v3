import { NextResponse } from "next/server";
import { getLiveState } from "@/entities/scenario/liveSim";

// Live state for the /live page. Today this is the simulated engine (a scenario is always "running"
// derived from the clock); when the real orchestrator + Guacamole broker land, only lib/liveSim.ts
// changes and this route keeps returning the same LiveState shape.
export const dynamic = "force-dynamic"; // never cache; the point is that it moves

export async function GET() {
  return NextResponse.json(getLiveState(), {
    headers: { "Cache-Control": "no-store" },
  });
}
