# HomeOps frontend

Interactive public application for `homelab.isaacwallace.dev`.

The first vertical slice is an SRE traffic-spike drill with a queue lifecycle, changing telemetry,
operator interventions, a correlated event stream, a request trace, and a sealed after-action report.

## Architecture

The frontend never speaks to Kubernetes. It speaks the public run-controller contract
(`docs/public-operations-arena.md` in the homelab repo), served here as same-origin BFF routes:

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/v1/scenarios` | Public scenario metadata + capacity |
| `POST /api/v1/runs` | Admit an allowlisted scenario (idempotent via `Idempotency-Key`) |
| `GET /api/v1/runs/{runId}` | Sanitized run read model (`RunView`) |
| `GET /api/v1/runs/{runId}/events` | Typed, sanitized SSE stream (`snapshot` / `lifecycle` / `decision` / `report-ready`) |
| `POST /api/v1/runs/{runId}/decisions` | Accept an allowlisted operator decision |
| `GET /api/v1/runs/{runId}/report` | Published after-action report |

Those routes are thin: they call the **`RunEngine`** in `@iw/lab-runtime`. Today that is an in-memory
engine whose entire run state is a deterministic function of the creation timestamp, the scenario
timeline, and the accepted decisions — no background jobs, no cluster. The lifecycle, capacity gate
(one active run), idempotency, decision availability, telemetry projection, and report scoring all
live there and are unit-tested (`packages/lab-runtime/src/engine.test.ts`).

### Production seam (Crossplane)

The `RunEngine` interface is the swap point. The homelab repo's README already defers Crossplane
"until there is a concrete self-service platform API worth testing" — this arena is that API. The
production engine implements the same interface by:

- `createRun` → create a namespaced **`LabRun` claim**; a Composition provisions the disposable
  namespace + `ResourceQuota` + `LimitRange` + default-deny `NetworkPolicy` + workload with a hard TTL.
- `getRun` / the SSE stream → project **sanitized** cluster state into the same `RunView` / `RunTelemetry`
  shapes (an allowlisted projection — never raw objects, logs, labels, env, or PromQL).
- `submitDecision` → patch the claim's allowlisted decision field.
- teardown → delete the claim; garbage collection removes the namespace. Idempotent, controller-owned.

Because the contract types are independent of Kubernetes, nothing above the `RunEngine` interface —
the routes, the client, the widget — changes when that swap lands.

```bash
npm run dev -w apps/homelab
npm run typecheck -w apps/homelab
npm run build -w apps/homelab
```
