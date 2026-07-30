# HomeOps frontend

Interactive public application for `homelab.isaacwallace.dev`.

HomeOps has four surfaces:

- `/` — live, sanitized cluster overview backed by the Kubernetes API and metrics-server.
- `/topology` — a layered flowchart of the allowlisted homelab inventory with live readiness,
  aggregate resource use, and GitOps state.
- `/practice` — a disposable application workspace that can be scaled, restarted, moved between
  worker pools, switched between stable/regressed releases, loaded with k6, cached, reset, and torn
  down. Drills run **on** that workspace, so `/drills` redirects here.
- `/leaderboard` — ranked standings across the multi-stage drills.

All displayed platform and workload values come from the live control plane. Architectural edges in
the topology are a sanitized allowlist matching the GitOps repository; they are not inferred or
invented in the browser.

## Architecture

The frontend never speaks to Kubernetes. It speaks the public run-controller contract
(`docs/public-operations-arena.md` in the homelab repo), served here as same-origin BFF routes:

| Endpoint                                  | Auth               | Purpose                                                                |
| :---------------------------------------- | :----------------- | :--------------------------------------------------------------------- |
| `GET /api/live/status`                    | public             | What this visitor may do: live configured, signed in, cluster they own |
| `GET /api/live/platform`                  | public (throttled) | Sanitized node readiness and run capacity                              |
| `GET /api/live/overview`                  | public (throttled) | Aggregate live nodes, workloads, pods, resources, GitOps, and capacity |
| `GET /api/live/topology`                  | public (throttled) | Allowlisted component graph with live readiness and metrics            |
| `GET /api/live/leaderboard`               | public (throttled) | Ranked standings; a session only marks a row as yours                  |
| `GET /api/live/drills`                    | session            | Drill catalog with the field's stats and the caller's own              |
| `POST /api/live/runs`                     | session            | Provision the caller's practice cluster (5/hour)                       |
| `GET /api/live/runs/{runId}/snapshot`     | session + owner    | One frame of the caller's cluster: run, telemetry, components, events  |
| `POST /api/live/runs/{runId}/drill`       | session + owner    | Start a drill on the caller's cluster (`DELETE` ends it)               |
| `POST /api/live/runs/{runId}/decisions`   | session + owner    | Apply an allowlisted operator decision                                 |
| `POST /api/live/runs/{runId}/renew`       | session + owner    | Buy one more window before expiry (once per cluster)                   |
| `GET /api/live/runs/{runId}/report`       | session + owner    | After-action report for a completed drill                              |
| `POST /api/live/practice/{runId}/actions` | session + owner    | Apply one allowlisted practice reconciliation                          |
| `DELETE /api/live/runs/{runId}`           | session + owner    | Tear the caller's cluster down                                         |

Every route above goes through `shared/api/guard.ts`. "session" means the visitor's SSO cookie is
replayed server-side against the auth service before anything happens; "owner" means the API itself
answers 404 for a cluster the caller did not provision, so run ids cannot be probed. Public routes
are still rate-limited per user (or per edge-supplied client address) because each one costs a real
Kubernetes read upstream.

These routes are the production path: they proxy server-side to `api.isaacwallace.dev`, which creates
Crossplane `LabRun` resources and reads measured Envoy, metrics-server, and OpenTelemetry signals.
The browser never receives the scoped API key or a Kubernetes credential.

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
    drill/                running a drill on a cluster
    topology/             the live architecture flowchart
      model/              layout engine, inventory poll, viewport, layer palette
      ui/                 TopologyBoard + the chart, node, toolbar, inspector
      topology.module.css scoped styling — layer colours declared once
      index.ts            the slice's public surface
  shared/                 api clients, the route guards, formatting
```

Each slice keeps its own `model/` (logic), `ui/` (presentation), scoped CSS, and an `index.ts` that
is the only thing outside the slice may import. `features/topology` holds everything about reading
the graph — ranking, crossing reduction, connector routing, pan and zoom — so `/topology` is a route
shell and nothing more.

```bash
npm run dev -w apps/homelab
npm run typecheck -w apps/homelab
npm run build -w apps/homelab
```
