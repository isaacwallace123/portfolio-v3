# HomeOps frontend

Interactive public application for `homelab.isaacwallace.dev`.

The first vertical slice is an SRE traffic-spike drill with a queue lifecycle, changing
telemetry, operator interventions, a correlated event stream, a request trace, and an evidence
completion state. It currently uses the shared deterministic fixture adapter in
`@iw/lab-runtime`; it does not connect a public browser to Kubernetes.

The production adapter will submit allowlisted scenario IDs to a narrow homelab run controller.
That controller owns namespace quotas, TTLs, event sanitization, evidence collection, and teardown.
The frontend's scenario and event contracts are intentionally independent of Kubernetes objects.

```bash
npm run dev -w apps/homelab
npm run typecheck -w apps/homelab
npm run build -w apps/homelab
```
