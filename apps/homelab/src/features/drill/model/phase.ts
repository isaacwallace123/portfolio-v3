"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrillOption, LiveRunView } from "@/shared/api/live-client";
import {
  impactOf,
  mark,
  type DecisionRecord,
  type TierImpact,
} from "./impact";

// The drill's state, said once and out loud.
//
// This used to be inferred at each render site from some combination of `!run.drillId`,
// `run.drillSolved`, `goals.every(met)` and `busy` — and every component inferred it slightly
// differently, which is exactly why the surface felt inconsistent. There is one derivation now, it
// returns a discriminated union, and the panel is a switch over it. A new state is a new case
// rather than another boolean threaded through five components.

export type DrillPhase =
  /** No drill on the cluster: choose one. */
  | { kind: "browsing" }
  /** A stage has just opened. On a cascade this is where the handoff note is read. */
  | { kind: "briefing" }
  /** Working the objective. */
  | { kind: "running" }
  /** Every condition met; the platform is confirming it holds. */
  | { kind: "holding" }
  /** A wrong move was applied and has not been acknowledged. Practice only. */
  | { kind: "misstep"; move: DrillOption; record: DecisionRecord | null }
  /** A ranked attempt ended by a wrong move. */
  | { kind: "failed"; move: DrillOption | null; record: DecisionRecord | null }
  /** Objective reached, on the final stage. */
  | { kind: "solved" };

export interface DrillState {
  phase: DrillPhase;
  /** Tiers to mark on the graph right now, so damage is visible where it happened. */
  impact: TierImpact[];
  /** Everything applied this drill, newest first — the damage ledger. */
  history: DecisionRecord[];
  /** Call instead of the raw decision action, so consequence can be measured from the click. */
  onChoose: (option: DrillOption) => void;
  acknowledge: () => void;
}

/** How long a decision's impact stays highlighted on the graph. */
const IMPACT_MS = 12_000;

export function useDrillState(
  // Nullable because the workbench has to call this before it knows whether a cluster exists —
  // hooks cannot live behind the early return that renders the launch screen.
  run: LiveRunView | null,
  act: (key: string, fn: () => Promise<LiveRunView | void>) => void,
  decide: (runId: string, optionId: string) => Promise<LiveRunView>,
): DrillState {
  // Acknowledgements are per drill attempt, keyed by what they acknowledge, so a reload or a poll
  // landing mid-read cannot silently re-open a screen the operator has already dismissed.
  const [ackedStage, setAckedStage] = useState<string | null>(null);
  const [ackedMissteps, setAckedMissteps] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<DecisionRecord[]>([]);
  // What the graph is currently marking. Held in state rather than derived from the clock at render
  // time: reading Date.now() while rendering makes the output depend on when React happens to run,
  // so the highlight would blink in and out with unrelated polls.
  const [lit, setLit] = useState<TierImpact[]>([]);

  // The run as it was when the option was clicked. Impact is a diff, so it needs the before.
  const pending = useRef<{ before: LiveRunView; option: DrillOption } | null>(null);
  const attempt = run ? `${run.drillId}:${run.drillStage}` : "";

  // A new drill clears everything: a ledger from the last attempt is not evidence about this one.
  const drillKey = run ? `${run.runId}:${run.drillId}` : "";
  const lastDrill = useRef(drillKey);
  useEffect(() => {
    if (lastDrill.current === drillKey) return;
    lastDrill.current = drillKey;
    setAckedStage(null);
    setAckedMissteps(new Set());
    setHistory([]);
    setLit([]);
    pending.current = null;
  }, [drillKey]);

  const onChoose = useCallback(
    (option: DrillOption) => {
      if (!run) return;
      pending.current = { before: run, option };
      act(`dec-${option.id}`, () => decide(run.runId, option.id));
    },
    [act, decide, run],
  );

  // Once the run comes back carrying the answer, record what the move did. Correctness is only
  // known after the round trip — that is the point of the exercise.
  useEffect(() => {
    const p = pending.current;
    if (!p || !run) return;
    const applied = run.drillOptions.find((o) => o.id === p.option.id);
    if (!applied?.chosen || applied.isCorrect === null) return;
    pending.current = null;
    const impact = impactOf(p.before, run);
    setHistory((prev) => [
      {
        optionId: applied.id,
        label: applied.label,
        correct: applied.isCorrect === true,
        at: Date.now(),
        impact,
        before: mark(p.before),
      },
      ...prev,
    ]);
    // Only a change that made something worse is worth marking in red on the graph.
    setLit(impact.filter((i) => i.degrading));
  }, [run]);

  // The mark is time-boxed: damage should draw the eye when it lands, not stay lit all drill.
  useEffect(() => {
    if (lit.length === 0) return;
    const id = window.setTimeout(() => setLit([]), IMPACT_MS);
    return () => window.clearTimeout(id);
  }, [lit]);

  const options = run?.drillOptions;
  const acknowledge = useCallback(() => {
    setAckedStage(attempt);
    if (!options?.some((o) => o.chosen && o.isCorrect === false)) return;
    setAckedMissteps((prev) => {
      const next = new Set(prev);
      for (const o of options)
        if (o.chosen && o.isCorrect === false) next.add(o.id);
      return next;
    });
  }, [attempt, options]);

  const phase = derivePhase(run, ackedStage, ackedMissteps, attempt, history);

  return { phase, impact: lit, history, onChoose, acknowledge };
}

function derivePhase(
  run: LiveRunView | null,
  ackedStage: string | null,
  ackedMissteps: Set<string>,
  attempt: string,
  history: DecisionRecord[],
): DrillPhase {
  if (!run?.drillId) return { kind: "browsing" };
  if (run.drillSolved) return { kind: "solved" };

  const recordFor = (id: string) =>
    history.find((h) => h.optionId === id) ?? null;

  // A ranked attempt is over the moment it goes wrong, and the broker is the one that says so.
  if (run.drillFailed) {
    const move =
      run.drillOptions.find((o) => o.id === run.drillFailedMove) ?? null;
    return { kind: "failed", move, record: move ? recordFor(move.id) : null };
  }

  // An unacknowledged wrong move takes the panel: the explanation is the reason the drill exists,
  // and it should not be something you can scroll past without noticing.
  const misstep = run.drillOptions.find(
    (o) => o.chosen && o.isCorrect === false && !ackedMissteps.has(o.id),
  );
  if (misstep)
    return { kind: "misstep", move: misstep, record: recordFor(misstep.id) };

  // The handoff explains what the last fix just caused; it is read before the next stage is worked.
  if (run.drillStageHandoff && ackedStage !== attempt) return { kind: "briefing" };

  const met = run.drillGoals.filter((g) => g.met).length;
  if (
    run.drillGoals.length > 0 &&
    met === run.drillGoals.length &&
    run.drillHoldSeconds > 0
  )
    return { kind: "holding" };

  return { kind: "running" };
}
