import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!liveEnabled()) {
    return NextResponse.json(
      { error: "Live inventory is not configured." },
      { status: 503 },
    );
  }
  const res = await liveFetch("/v1/topology");
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
