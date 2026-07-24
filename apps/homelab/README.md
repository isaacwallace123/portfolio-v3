# HomeOps frontend

Interactive public application for `homelab.isaacwallace.dev`.

HomeOps has four surfaces:

- `/` — live, sanitized cluster overview backed by the Kubernetes API and metrics-server.
- `/topology` — a Three.js map of the allowlisted homelab inventory with live readiness, aggregate
  resource use, and GitOps state.
- `/practice` — a disposable application workspace that can be scaled, restarted, moved between
  worker pools, switched between stable/regressed releases, loaded with k6, cached, reset, and torn
  down.
- `/drills` — four bounded SRE drills: traffic-spike mitigation, bad-release tracing and rollback,
  data-tier recovery, and scoped worker evacuation.

All displayed platform and workload values come from the live control plane. Architectural edges in
the topology are a sanitized allowlist matching the GitOps repository; they are not inferred or
invented in the browser.

## Architecture

The frontend never speaks to Kubernetes. It speaks the public run-controller contract
(`docs/public-operations-arena.md` in the homelab repo), served here as same-origin BFF routes:

| Endpoint                                  | Purpose                                                                              |
| :---------------------------------------- | :----------------------------------------------------------------------------------- |
| `GET /api/live/platform`                  | Sanitized node readiness and run capacity                                            |
| `GET /api/live/overview`                  | Aggregate live nodes, workloads, pods, resources, GitOps, and sandbox capacity       |
| `GET /api/live/topology`                  | Allowlisted component graph with live readiness and metrics                          |
| `GET /api/v1/scenarios`                   | Public scenario metadata + capacity                                                  |
| `POST /api/v1/runs`                       | Admit an allowlisted scenario (idempotent via `Idempotency-Key`)                     |
| `GET /api/v1/runs/{runId}`                | Sanitized run read model (`RunView`)                                                 |
| `GET /api/v1/runs/{runId}/events`         | Typed, sanitized SSE stream (`snapshot` / `lifecycle` / `decision` / `report-ready`) |
| `POST /api/v1/runs/{runId}/decisions`     | Accept an allowlisted operator decision                                              |
| `GET /api/v1/runs/{runId}/report`         | Published after-action report                                                        |
| `GET /api/live/runs/{runId}/trace`        | Latest sanitized OpenTelemetry trace                                                 |
| `POST /api/live/practice/{runId}/actions` | Apply one allowlisted practice reconciliation                                        |

The `/api/v1` routes remain a deterministic reference adapter for local contract tests. The page's
`/api/live` routes are the production path: they proxy server-side to `api.isaacwallace.dev`, which
creates Crossplane `LabRun` resources and reads measured Envoy, metrics-server, and OpenTelemetry
signals. The browser never receives the scoped API key or a Kubernetes credential.

### Production runtime (Crossplane)

The homelab repository owns the Crossplane XRD and Composition. The API implements the public
contract by:

- `createRun` → create a cluster-scoped **`LabRun` composite**; a Composition provisions the disposable
  namespace + `ResourceQuota` + `LimitRange` + default-deny `NetworkPolicy` + workload with a hard TTL.
- `getRun` / the SSE stream → project **sanitized** cluster state into the same `RunView` / `RunTelemetry`
  shapes (an allowlisted projection — never raw objects, logs, labels, env, or PromQL).
- `submitDecision` → patch the claim's allowlisted decision field.
- teardown → delete the claim; garbage collection removes the namespace. Idempotent, controller-owned.

Because the public contract types are independent of Kubernetes, the browser only sees the bounded
run model even as scenario internals evolve.

```bash
npm run dev -w apps/homelab
npm run typecheck -w apps/homelab
npm run build -w apps/homelab
```
