# HomeOps frontend

Interactive public application for `homelab.isaacwallace.dev`.

HomeOps has five surfaces:

- `/` — live, sanitized cluster overview backed by the Kubernetes API and metrics-server.
- `/topology` — the allowlisted homelab inventory grouped by layer, with live readiness, aggregate
  resource use, and GitOps state. Point at a component to trace what it depends on.
- `/practice` — HomeOps Academy: a structured production-operations course with interactive
  lessons, knowledge checkpoints, account-backed progress, and unranked real-cluster capstones.
- `/practice/sandbox` — the open disposable application workspace, with no course objective,
  progress, or ranking.
- `/ranked` — a dedicated competitive surface for server-drawn, one-shot cascades on the same real
  Kubernetes arena engine, with seasonless ELO and independent official times.
- `/leaderboard` — ranked standings across the multi-stage drills.

All displayed platform and workload values come from the live control plane. Architectural edges in
the topology are a sanitized allowlist matching the GitOps repository; they are not inferred or
invented in the browser.

## Architecture

The frontend never speaks to Kubernetes. It speaks the public run-controller contract
(`docs/public-operations-arena.md` in the homelab repo), served here as same-origin BFF routes:

| Endpoint                                   | Auth               | Purpose                                                                |
| :----------------------------------------- | :----------------- | :--------------------------------------------------------------------- |
| `GET /api/live/status`                     | public             | What this visitor may do: live configured, signed in, cluster they own |
| `GET /api/live/platform`                   | public (throttled) | Sanitized node readiness and run capacity                              |
| `GET /api/live/overview`                   | public (throttled) | Aggregate live nodes, workloads, pods, resources, GitOps, and capacity |
| `GET /api/live/topology`                   | public (throttled) | Allowlisted component graph with live readiness and metrics            |
| `GET /api/live/leaderboard`                | public (throttled) | Ranked standings; a session only marks a row as yours                  |
| `GET /api/live/ranked/leaderboard`         | public (throttled) | Seasonless ELO ladder; a session only marks a row as yours             |
| `GET /api/live/ranked/profile`             | signed in          | Rating, division, progression, and the caller's recent match ledger    |
| `GET /api/live/learning/progress`          | signed in          | Current Academy course and unit progress                               |
| `POST /api/live/learning/units/{id}/*`     | signed in          | Start or complete coursework; cluster units are broker-owned           |
| `POST /api/live/learning/certificate`      | signed in          | Issue once after server-side eligibility checks                        |
| `GET /api/live/learning/certificates/{id}` | public (throttled) | Verify an opaque certificate identifier                                |
| `GET /api/live/drills`                     | session            | Drill catalog with the field's stats and the caller's own              |
| `POST /api/live/runs`                      | session            | Provision the caller's practice cluster (5/hour)                       |
| `GET /api/live/runs/{runId}/snapshot`      | session + owner    | One frame of the caller's cluster: run, telemetry, components, events  |
| `POST /api/live/runs/{runId}/drill`        | session + owner    | Start a drill on the caller's cluster (`DELETE` ends it)               |
| `POST /api/live/runs/{runId}/decisions`    | session + owner    | Apply an allowlisted operator decision                                 |
| `POST /api/live/runs/{runId}/renew`        | session + owner    | Buy one more window before expiry (once per cluster)                   |
| `GET /api/live/runs/{runId}/report`        | session + owner    | After-action report for a completed drill                              |
| `POST /api/live/practice/{runId}/actions`  | session + owner    | Apply one allowlisted practice reconciliation                          |
| `DELETE /api/live/runs/{runId}`            | session + owner    | Tear the caller's cluster down                                         |

Every route above goes through `shared/api/guard.ts`. "session" means the visitor's SSO cookie is
replayed server-side against the auth service before anything happens; "owner" means the API itself
answers 404 for a cluster the caller did not provision, so run ids cannot be probed. Public routes
are still rate-limited per user (or per edge-supplied client address) because each one costs a real
Kubernetes read upstream.

These routes are the production path: they proxy server-side to `api.isaacwallace.dev`, which creates
Crossplane `LabRun` resources and reads measured Envoy, metrics-server, and OpenTelemetry signals.
The browser never receives the scoped API key or a Kubernetes credential.

### Ranked scoring

Ranked is seasonless. An operator starts at 1000 and plays against the fixed rating of the
server-drawn scenario. The standard ELO expected-score formula determines the result:

- the first ten rated matches use K=40; established operators use K=24;
- five matches are presented as placements, but they are ordinary durable rating updates rather
  than a hidden or disposable provisional score;
- completion is a win; a wrong operational move is a loss;
- forfeiting or allowing the cluster to expire is a loss with a minimum 12-point penalty (subject
  to the global 100-point floor), so hard scenarios cannot be cheaply dodged until an easier draw
  appears;
- time never enters the rating calculation. Successful matches also write an independent official
  time used by the speed boards;
- rating, attempt outcome, and the append-only ledger mutation commit in one serializable
  transaction. Repeated terminal observations return the existing result instead of scoring twice.

### Academy progress

Academy learning state is separate from live cluster state and Ranked rating. Lessons and
checkpoints may be completed without provisioning infrastructure. A capstone launch binds its
course unit to an unranked practice drill, and only the run broker records that unit after the live
objective has held against measured telemetry. The LabRun id is the idempotency key, so repeated
snapshot polls cannot record the same solve twice. Certificates are account-backed, issued once per
course version, and publicly verifiable by an opaque random identifier.

### Production runtime (Crossplane)

The homelab repository owns the Crossplane XRD and Composition. The API implements the public
contract by:

- `createRun` → create a cluster-scoped **`LabRun` composite**; a Composition provisions the disposable
  namespace + `ResourceQuota` + `LimitRange` + default-deny `NetworkPolicy` + workload with a hard TTL.
- `getRun` / `snapshot` → project **sanitized** cluster state into the same `RunView` / `RunTelemetry`
  shapes (an allowlisted projection — never raw objects, logs, labels, env, or PromQL). The page polls
  one snapshot per frame rather than five reads, which keeps a 1.2s tick inside the per-key window.
- `submitDecision` → patch the claim's allowlisted decision field.
- teardown → delete the claim; garbage collection removes the namespace. Idempotent, controller-owned.

Because the public contract types are independent of Kubernetes, the browser only sees the bounded
run model even as scenario internals evolve.

### Structure

Feature-Sliced Design, so a capability is one directory rather than a trail through five of them.

```
src/
  app/                    routes — a shell, metadata, and the one thing it renders
  widgets/                page-level compositions (cluster-workbench, leaderboard, HomeOverview)
  features/
    academy/              course content, progress rules, lessons, visuals, and certificates
    drill/                running a drill on a cluster
    ranked/               rating profile, match entry, and authoritative result presentation
    topology/             the live architecture map
      model/              grouped layout, inventory poll, viewport, layer palette
      ui/                 TopologyBoard + the map, component, toolbar, inspector
      topology.module.css scoped styling — layer colours declared once
      index.ts            the slice's public surface
  shared/                 api clients, the route guards, formatting
```

Each slice keeps its own `model/` (logic), `ui/` (presentation), scoped CSS, and an `index.ts` that
is the only thing outside the slice may import. `features/topology` holds everything about reading
the graph — grouping, sizing, connector routing, pan and zoom — so `/topology` is a route shell and
nothing more.

The topology page draws every component inside a container for its layer rather than giving each one
its own rank in a flowchart. That was measured, not assumed: a rank per component came out 2050px
wide with 83% of the connector ink running sideways and one edge in thirty-eight a clean vertical
drop, and dagre reproduced the same sprawl from the same graph — the limit is the shape of the
system, not the layout engine. Grouping lands at 1306×900, which a panel shows at nearly full size,
because a container is a background rather than an obstacle and the eye groups by enclosure instead
of by tracing lines. Connectors stay coarse at rest, one per pair of layers; a component's own links
are drawn when you point at it.

```bash
npm run dev -w apps/homelab
npm run typecheck -w apps/homelab
npm run build -w apps/homelab
```
