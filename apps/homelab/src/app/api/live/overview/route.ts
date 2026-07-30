import { guardInventory, jsonNoStore } from "@/shared/api/guard";
import { liveFetch } from "@/shared/api/live-server";

// GET /api/live/overview — aggregate nodes, workloads, pods, resources, GitOps, and capacity.
// Public but throttled: upstream this is a cluster-wide Kubernetes sweep. See guardInventory.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = guardInventory(req);
  if (denied) return denied;

  const res = await liveFetch("/v1/overview");
  return jsonNoStore(await res.json().catch(() => ({})), res.status);
}
