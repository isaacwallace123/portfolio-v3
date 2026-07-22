import type {
  CaseStudy,
  LiveEvent,
  LiveSession,
  LiveState,
  QueueItem,
  Role,
  Step,
} from "./types";
import { getCaseStudies } from "./scenarios";

// Simulated live engine.
//
// The /live page needs to show scenarios "constantly running." Until the real orchestrator + a
// read-only Guacamole broker exist, this derives a plausible live session deterministically from the
// wall clock: it rotates through the case studies, and for the one that is "live right now" computes
// how far in it is and which actor is currently on screen. Poll it and the page genuinely moves.
//
// The RETURN SHAPE is the contract. When the real backend lands, only this file changes: swap the
// clock math for the orchestrator's session state and the Guacamole stream URL, and set
// streamMode: "guacamole". The page and its types stay put.

const GAP_SEC = 6; // brief "resetting the range" pause between runs

// Queue is process-memory only (a demo affordance; resets when the server restarts). A real queue is
// persisted and drained by the orchestrator.
const queue: QueueItem[] = [];

function estimateDuration(study: CaseStudy): number {
  if (study.durationSec) return study.durationSec;
  // ~2.4s of screen time per command step, ~1.6s per narration beat.
  return study.steps.reduce((acc, s) => acc + (s.run != null ? 2.4 : 1.6), 0);
}

/** Per-step screen-time offsets, so we can map elapsed seconds to a step index. */
function stepTimeline(study: CaseStudy): number[] {
  const offsets: number[] = [];
  let t = 0;
  for (const s of study.steps) {
    offsets.push(t);
    t += s.run != null ? 2.4 : 1.6;
  }
  return offsets;
}

function roleOf(study: CaseStudy, terminalId: string): Role {
  return (
    study.terminals.find((t) => t.id === terminalId) ?? study.terminals[0]
  ).role;
}

function eventsUpTo(study: CaseStudy, stepIdx: number): LiveEvent[] {
  const offs = stepTimeline(study);
  const evs: LiveEvent[] = [];
  for (let i = 0; i <= stepIdx && i < study.steps.length; i++) {
    const s: Step = study.steps[i];
    const role = roleOf(study, s.terminal);
    if (s.say)
      evs.push({
        t: offs[i],
        actor: s.terminal,
        role,
        kind: "narration",
        text: s.say,
      });
    if (s.run != null)
      evs.push({
        t: offs[i],
        actor: s.terminal,
        role,
        kind: "command",
        text: s.run,
      });
    (s.out ?? []).forEach((o) => {
      const isDetect = /^§\[/.test(o);
      evs.push({
        t: offs[i],
        actor: s.terminal,
        role,
        kind: isDetect ? "detection" : "output",
        text: o.replace(/§/g, ""),
      });
    });
  }
  return evs;
}

/** Build the live screen (rolling console) for the currently-acting terminal. */
function screenFor(study: CaseStudy, stepIdx: number) {
  const active = study.steps[Math.min(stepIdx, study.steps.length - 1)];
  const actorId = active.terminal;
  const role = roleOf(study, actorId);
  const term =
    study.terminals.find((t) => t.id === actorId) ?? study.terminals[0];
  const lines: string[] = [];
  for (let i = 0; i <= stepIdx && i < study.steps.length; i++) {
    const s = study.steps[i];
    if (s.terminal !== actorId) continue;
    if (s.say) lines.push(`# ${s.say}`);
    if (s.run != null) lines.push(`$ ${s.run}`);
    (s.out ?? []).forEach((o) => lines.push(o.replace(/§/g, "")));
  }
  return { actor: actorId, role, title: term.title, lines: lines.slice(-14) };
}

export function getLiveState(nowMs = Date.now()): LiveState {
  const studies = getCaseStudies();
  const durations = studies.map(estimateDuration);
  const cycle = durations.reduce((a, d) => a + d + GAP_SEC, 0);

  const nowSec = Math.floor(nowMs / 1000);
  let pos = nowSec % Math.max(1, Math.round(cycle));

  // Walk the rotation to find which study is live and how far in.
  let idx = 0;
  let elapsed = 0;
  for (let i = 0; i < studies.length; i++) {
    const span = durations[i] + GAP_SEC;
    if (pos < span) {
      idx = i;
      elapsed = Math.min(pos, durations[i]);
      break;
    }
    pos -= span;
  }

  const study = studies[idx];
  const offs = stepTimeline(study);
  let currentStep = 0;
  for (let i = 0; i < offs.length; i++) if (elapsed >= offs[i]) currentStep = i;

  const activity = eventsUpTo(study, currentStep).slice(-12);
  const screen = screenFor(study, currentStep);

  const session: LiveSession = {
    caseStudyId: study.id,
    title: study.title,
    summary: study.summary,
    startedAt: nowMs - elapsed * 1000,
    elapsedSec: Math.round(elapsed),
    durationSec: Math.round(durations[idx]),
    currentStep,
    totalSteps: study.steps.length,
    actors: study.terminals.map((t) => ({
      id: t.id,
      role: t.role,
      title: t.title,
    })),
    activeActor: screen.actor,
    activity,
    screen,
  };

  return {
    now: nowMs,
    live: session,
    queue: [...queue],
    streamMode: "simulated",
  };
}

export function enqueue(
  caseStudyId: string,
  requestedBy = "guest",
): QueueItem | null {
  const study = getCaseStudies().find((s) => s.id === caseStudyId);
  if (!study) return null;
  const item: QueueItem = {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    caseStudyId,
    title: study.title,
    queuedAt: Date.now(),
    requestedBy,
  };
  queue.push(item);
  if (queue.length > 12) queue.shift();
  return item;
}
