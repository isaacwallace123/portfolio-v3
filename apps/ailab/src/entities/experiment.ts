import type { LabScenario } from "@iw/lab-runtime";

export const agentArenaExperiment: LabScenario = {
  id: "dual-agent-repair",
  lab: "ailab",
  title: "Repair the failing service",
  eyebrow: "Agent benchmark 01",
  summary:
    "Two local models enter identical disposable repositories. Watch every tool call, test run, token, and GPU cycle—then inspect the judge.",
  durationMs: 52_000,
  difficulty: "operator",
  resourceClass: "heavy",
  decisions: [
    {
      id: "hint-a",
      label: "Hint primary",
      description: "Tell the primary agent to inspect timezone normalization.",
      availableAfterMs: 18_000,
    },
    {
      id: "hint-b",
      label: "Hint fast",
      description: "Tell the fast agent to inspect timezone normalization.",
      availableAfterMs: 18_000,
    },
  ],
  events: [
    {
      id: "reserve",
      offsetMs: 0,
      phase: "Scheduling",
      source: "orchestrator",
      title: "Experiment admitted",
      detail:
        "Reserved both Intel GPU workers and two isolated code sandboxes.",
      severity: "info",
    },
    {
      id: "sandboxes",
      offsetMs: 4_000,
      phase: "Preparing",
      source: "sandbox-controller",
      title: "Identical repositories mounted",
      detail:
        "Commit 3a5c771 and the hidden evaluation suite were checksum verified.",
      severity: "success",
    },
    {
      id: "models",
      offsetMs: 8_000,
      phase: "Inference",
      source: "litellm",
      title: "Local routes connected",
      detail:
        "local-primary and local-fast received the same task and token budget.",
      severity: "success",
    },
    {
      id: "inspect",
      offsetMs: 14_000,
      phase: "Tool use",
      source: "local-primary",
      title: "Inspected failing tests",
      detail:
        "Found three failures around ISO timestamps and daylight-saving boundaries.",
      severity: "info",
    },
    {
      id: "fast-path",
      offsetMs: 17_000,
      phase: "Tool use",
      source: "local-fast",
      title: "Patched serializer",
      detail:
        "Changed the output format before checking the date parsing call site.",
      severity: "warning",
    },
    {
      id: "primary-test",
      offsetMs: 27_000,
      phase: "Verification",
      source: "local-primary",
      title: "Focused tests passed",
      detail: "Timezone normalization fixed all three discovered regressions.",
      severity: "success",
    },
    {
      id: "fast-test",
      offsetMs: 31_000,
      phase: "Verification",
      source: "local-fast",
      title: "One hidden edge case remains",
      detail:
        "The naive datetime case still fails under the evaluator timezone.",
      severity: "critical",
    },
    {
      id: "judge",
      offsetMs: 43_000,
      phase: "Evaluation",
      source: "deterministic-judge",
      title: "Independent suite complete",
      detail:
        "Primary: 18/18 tests. Fast: 17/18 tests. Repository policies satisfied.",
      severity: "success",
    },
    {
      id: "report",
      offsetMs: 50_000,
      phase: "Evidence",
      source: "experiment-store",
      title: "Reproducible report published",
      detail:
        "Prompts, patches, traces, metrics, and evaluator hashes were recorded.",
      severity: "success",
    },
  ],
};

export const agentLogs = {
  primary: [
    {
      at: 10_000,
      kind: "thought",
      text: "Map failures to the timestamp boundary.",
    },
    { at: 14_000, kind: "tool", text: "$ pytest tests/test_events.py -q" },
    { at: 20_000, kind: "edit", text: "M src/events/serializer.py  +8 −3" },
    { at: 27_000, kind: "pass", text: "3 focused tests passed in 0.42s" },
    { at: 37_000, kind: "pass", text: "18 tests passed in 1.86s" },
  ],
  fast: [
    { at: 10_000, kind: "thought", text: "Normalize emitted ISO timestamps." },
    { at: 15_000, kind: "edit", text: "M src/events/serializer.py  +4 −1" },
    { at: 22_000, kind: "tool", text: "$ pytest -q" },
    { at: 31_000, kind: "fail", text: "1 failed, 17 passed in 1.33s" },
    { at: 39_000, kind: "edit", text: "M src/events/parser.py  +2 −0" },
  ],
};

export const pipelineStages = [
  { id: "task", label: "Task", at: 0 },
  { id: "sandbox", label: "Sandbox", at: 4_000 },
  { id: "inference", label: "Inference", at: 8_000 },
  { id: "tools", label: "Tool loop", at: 14_000 },
  { id: "tests", label: "Evaluation", at: 40_000 },
  { id: "report", label: "Report", at: 50_000 },
];
