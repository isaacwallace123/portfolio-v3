# AI Lab frontend

Interactive public application for `ailab.isaacwallace.dev`.

The first vertical slice is a dual-agent code-repair experiment with two local model lanes,
tool and patch events, GPU telemetry, human hints, deterministic evaluation, and a reproducible
report state. It currently uses the shared deterministic fixture adapter in `@iw/lab-runtime`;
it does not expose LiteLLM, Open WebUI, model workers, or sandbox credentials to the browser.

The production adapter will submit allowlisted benchmark IDs to an AI experiment controller.
That controller owns GPU admission, isolated sandboxes, model credentials, trace redaction,
evaluation, artifact publication, and teardown.

```bash
npm run dev -w apps/ailab
npm run typecheck -w apps/ailab
npm run build -w apps/ailab
```
