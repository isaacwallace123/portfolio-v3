import type { CaseStudy, Role, Step, Terminal } from "./types";

// Adapter: cyberlab-recording/1  ->  CaseStudy.
//
// This is the TypeScript twin of the adapter in tools/scenario-player/web/theater.html. A recording
// is a flat, timestamped, per-actor event log (produced by player.py --record / orchestrate.py
// --record on real VMs); this regroups those events back into the explained steps the player
// replays. Same format the whole pipeline shares, so a real capture becomes a case study unchanged.

const KNOWN_ROLES = new Set<Role>([
  "attacker",
  "responder",
  "hardener",
  "victim",
  "operator",
]);
const coerceRole = (r: unknown): Role =>
  KNOWN_ROLES.has(r as Role) ? (r as Role) : "operator";

interface RecEvent {
  t?: number;
  step?: number;
  actor?: string;
  kind: string;
  text?: string;
  shell?: string;
  source?: string;
  rule_id?: string;
}

interface RecordingDoc {
  schema?: string;
  id?: string;
  scenario?: { id?: string; title?: string };
  created?: string;
  duration?: number;
  actors?: Array<{
    id: string;
    role?: string;
    title?: string;
    prompt?: string;
    geometry?: string;
  }>;
  events?: RecEvent[];
}

function synthGeometry(i: number, n: number): string {
  if (n <= 1) return "120x32+0+0";
  const cols = 2,
    w = 104,
    h = 24,
    gx = w + 44,
    gy = h + 34;
  return `${w}x${h}+${(i % cols) * gx}+${Math.floor(i / cols) * gy}`;
}

/** Convert a parsed recording document into a CaseStudy. `meta` supplies editorial fields the raw
 *  capture doesn't carry (summary, purpose, tags). */
export function recordingToCaseStudy(
  doc: RecordingDoc,
  meta: { summary: string; purpose?: string; tags?: string[] },
): CaseStudy {
  if (!doc || doc.schema !== "cyberlab-recording/1")
    throw new Error("Not a cyberlab-recording/1 document.");
  const actorsIn = doc.actors ?? [];
  if (!actorsIn.length) throw new Error("Recording has no actors.");

  const terminals: Terminal[] = actorsIn.map((a, i) => ({
    id: a.id,
    role: coerceRole(a.role),
    title: a.title ?? a.id,
    prompt: a.prompt ?? `${a.id}$ `,
    speed: 34,
    geometry: a.geometry ?? synthGeometry(i, actorsIn.length),
  }));
  const firstActor = actorsIn[0].id;

  const byStep = new Map<number, RecEvent[]>();
  (doc.events ?? []).forEach((e, idx) => {
    const k = e.step != null ? e.step : idx;
    (byStep.get(k) ?? byStep.set(k, []).get(k)!).push(e);
  });

  const steps: Step[] = [];
  [...byStep.keys()]
    .sort((a, b) => a - b)
    .forEach((k) => {
      const evs = byStep.get(k)!;
      const actor = evs.find((e) => e.actor)?.actor ?? firstActor;
      const say = evs.find((e) => e.kind === "narration")?.text;
      const cmd = evs.find((e) => e.kind === "command");
      const out: string[] = [];
      evs
        .filter((e) => e.kind === "output")
        .forEach((e) =>
          String(e.text ?? "")
            .split("\n")
            .forEach((l) => out.push(l)),
        );
      evs
        .filter((e) => e.kind === "detection")
        .forEach((e) =>
          out.push(
            `§[${e.source ?? "alert"}${e.rule_id ? " " + e.rule_id : ""}] ${e.text ?? ""}§`,
          ),
        );
      const step: Step = { terminal: actor };
      if (say) step.say = say;
      if (cmd?.text != null) step.run = cmd.text;
      if (out.length) step.out = out;
      steps.push(step);
    });
  if (!steps.length) throw new Error("Recording has no replayable steps.");

  return {
    id: doc.scenario?.id ?? doc.id ?? "recording",
    title: doc.scenario?.title ?? "Captured recording",
    summary: meta.summary,
    purpose: meta.purpose,
    tags: meta.tags,
    recorded: true,
    recordingFile: doc.id,
    durationSec: doc.duration,
    terminals,
    steps,
  };
}

/** Roles present in a case study, in first-seen order — used for legends and gallery strips. */
export function rolesOf(study: CaseStudy): Role[] {
  const seen: Role[] = [];
  study.terminals.forEach((t) => {
    if (!seen.includes(t.role)) seen.push(t.role);
  });
  return seen;
}

export const ROLE_LABEL: Record<Role, string> = {
  attacker: "Black hat",
  responder: "White hat",
  hardener: "Red hat",
  victim: "Victim",
  operator: "Operator",
};
