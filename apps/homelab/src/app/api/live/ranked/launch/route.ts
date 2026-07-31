import { guard, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

export const dynamic = "force-dynamic";

// Read a launch, or abandon one. Advancing it happens on ./stream, which holds a single connection
// open and drives the state machine upstream — there is deliberately no POST here any more, because
// a client that can only observe and cancel cannot step a launch into a state by hand.
async function forward(req: Request, method: "GET" | "DELETE") {
  const g = await guard(req, {
    kind: method === "GET" ? "read" : "cancel",
  });
  if (!g.ok) return g.response;

  const res = await liveFetch(
    "/v1/ranked/launch",
    { method },
    g.caller.owner,
    g.caller.displayName,
  );
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}

export async function GET(req: Request) {
  return forward(req, "GET");
}

export async function DELETE(req: Request) {
  return forward(req, "DELETE");
}
