import { NextResponse } from "next/server";
import { liveEnabled, liveFetch } from "@/shared/lib/liveApi";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!liveEnabled()) {
    return NextResponse.json(
      { error: "Live provisioning is not configured." },
      { status: 503 },
    );
  }

  const res = await liveFetch("/v1/platform");
  const payload = await res.json().catch(() => ({}));
  return NextResponse.json(payload, {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
