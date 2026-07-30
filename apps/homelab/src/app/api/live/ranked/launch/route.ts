import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

async function forward(req: Request, method: "GET" | "POST" | "DELETE") {
  const url = new URL(req.url);
  const start = method === "POST" && url.searchParams.get("start") === "true";
  const g = await guard(req, {
    kind:
      method === "GET"
        ? "read"
        : method === "DELETE"
          ? "cancel"
          : start
            ? "provision"
            : "launch",
  });
  if (!g.ok) return g.response;

  const retry = method === "POST" && url.searchParams.get("retry") === "true";
  const res = await liveFetch(
    "/v1/ranked/launch",
    {
      method,
      ...(method === "POST"
        ? { body: JSON.stringify({ retry, start }) }
        : undefined),
    },
    g.caller.owner,
    g.caller.displayName,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}

export async function GET(req: Request) {
  return forward(req, "GET");
}

export async function POST(req: Request) {
  return forward(req, "POST");
}

export async function DELETE(req: Request) {
  return forward(req, "DELETE");
}
