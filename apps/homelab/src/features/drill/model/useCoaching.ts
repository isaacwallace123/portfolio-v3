"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveRunView, RunComponent } from "@/shared/api/live-client";
import {
  buildDebrief,
  coachingPhase,
  evidenceFor,
  hypothesesFor,
  type CoachingPhase,
  type CoachingRecord,
  type Debrief,
  type EvidenceItem,
  type HypothesisOption,
} from "./coaching";
import type { DrillState } from "./phase";

// The teaching flow's state. Practice only.
//
// Everything about *what* the flow is lives in `coaching.ts` as pure functions; this holds the
// three pieces of local state that cannot be derived — what has been looked at, what was
// hypothesised, and whether the last consequence has been read — and resets them when a new drill
// starts. Keeping the derivation pure is what makes the flow testable without a cluster.

export interface Coaching {
  phase: CoachingPhase;
  evidence: EvidenceItem[];
  inspected: Set<string>;
  hypotheses: HypothesisOption[];
  hypothesis: HypothesisOption | null;
  /** Non-null once the drill has resolved. */
  debrief: Debrief | null;
  inspect: (item: EvidenceItem) => void;
  choose: (option: HypothesisOption) => void;
  readBriefing: () => void;
  /** The learner has finished reading the evidence and wants to move on. */
  finishObserving: () => void;
  readConsequence: () => void;
  /** Whether the operator controls should accept input. Gated on evidence, never on a clock. */
  decisionsEnabled: boolean;
}

export function useCoaching(
  run: LiveRunView | null,
  components: RunComponent[],
  drill: DrillState,
): Coaching {
  const [briefingRead, setBriefingRead] = useState(false);
  const [inspected, setInspected] = useState<Set<string>>(new Set());
  const [evidenceDone, setEvidenceDone] = useState(false);
  const [hypothesisId, setHypothesisId] = useState<string | null>(null);
  const [consequenceRead, setConsequenceRead] = useState<string | null>(null);
  // The measurements at the moment the controls unlocked — the "before" the debrief compares
  // against. Captured once, because a debrief that compares against the last poll compares the fix
  // with itself.
  const [opening, setOpening] = useState<CoachingRecord["opening"]>(null);

  // A new drill on this cluster is a new incident: everything above describes the last one.
  const drillKey = run ? `${run.runId}:${run.drillId}:${run.drillStage}` : "";
  const lastKey = useRef(drillKey);
  useEffect(() => {
    if (lastKey.current === drillKey) return;
    lastKey.current = drillKey;
    setBriefingRead(false);
    setInspected(new Set());
    setEvidenceDone(false);
    setHypothesisId(null);
    setConsequenceRead(null);
    setOpening(null);
  }, [drillKey]);

  const evidence = useMemo(
    () => (run ? evidenceFor(run, components) : []),
    [run, components],
  );
  const hypotheses = useMemo(() => (run ? hypothesesFor(run) : []), [run]);

  // The newest decision the learner has not acknowledged. `history` is newest-first.
  const latest = drill.history[0] ?? null;
  const unreadConsequence =
    latest !== null && consequenceRead !== `${latest.optionId}-${latest.at}`;

  const phase: CoachingPhase = run
    ? coachingPhase({
        run,
        drillPhase: drill.phase.kind,
        inspected,
        evidenceCount: evidence.length,
        evidenceDone,
        hypothesis: hypothesisId,
        briefingRead,
        unreadConsequence,
      })
    : "briefing";

  const hypothesis = hypotheses.find((h) => h.id === hypothesisId) ?? null;

  const debrief = useMemo(() => {
    if (!run || phase !== "debrief") return null;
    return buildDebrief(
      run,
      {
        hypothesisId,
        hypothesisLabel: hypothesis?.label ?? null,
        inspected: [...inspected],
        opening,
      },
      drill.history,
      hypotheses,
    );
  }, [
    run,
    phase,
    hypothesisId,
    hypothesis,
    inspected,
    opening,
    drill.history,
    hypotheses,
  ]);

  const inspect = useCallback((item: EvidenceItem) => {
    setInspected((prev) => {
      if (prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }, []);

  // Choosing a hypothesis is the moment the controls unlock, so it is also the moment to record
  // the "before" the debrief will compare against. Captured in the event rather than in an effect
  // watching the phase: the phase changes because of this click, and deriving it from a render
  // would mean the snapshot depends on when React happened to run rather than on what the learner
  // did. It is also the honest instant — these are the numbers they diagnosed from.
  const choose = useCallback(
    (option: HypothesisOption) => {
      setHypothesisId(option.id);
      if (!run) return;
      setOpening(
        (prev) =>
          prev ?? {
            offered: run.offeredRequestsPerSec,
            served: run.telemetry.requestsPerSec,
            p95: run.telemetry.p95LatencyMs,
            errors: run.telemetry.errorRatePct,
          },
      );
    },
    [run],
  );

  const readConsequence = useCallback(() => {
    if (latest) setConsequenceRead(`${latest.optionId}-${latest.at}`);
    // The underlying drill state has its own misstep acknowledgement, and both have to clear or
    // the panel bounces between two screens that each think they are showing the same thing.
    drill.acknowledge();
  }, [latest, drill]);

  return {
    phase,
    evidence,
    inspected,
    hypotheses,
    hypothesis,
    debrief,
    inspect,
    choose,
    readBriefing: () => setBriefingRead(true),
    finishObserving: () => setEvidenceDone(true),
    readConsequence,
    decisionsEnabled: phase === "act" || phase === "verify",
  };
}
