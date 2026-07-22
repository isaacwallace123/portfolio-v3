// Shared domain types for the cyberlab site.
//
// A CaseStudy is the playable unit: metadata (what it is, why it matters) plus the actor terminals
// and the ordered steps a replay types out. It is produced two ways that converge on this one shape:
//   1. hand-authored scripted scenarios (content/scenarios/*.json), and
//   2. real captures (content/recordings/*.recording.json, cyberlab-recording/1) run through the
//      adapter in lib/recording.ts.
// Everything downstream — the gallery, the player, the live view — speaks CaseStudy only.

export type Role =
  "attacker" | "responder" | "hardener" | "victim" | "operator";

export interface Terminal {
  id: string;
  role: Role;
  title: string;
  prompt: string;
  /** typing speed in chars/sec for the replay */
  speed?: number;
  /** COLSxROWS+X+Y, as used by the scenario-player drivers; drives on-stage placement */
  geometry?: string;
}

export interface Step {
  /** id of the Terminal that types this step */
  terminal: string;
  /** narration / explanation shown above the command and in the steps panel */
  say?: string;
  /** the command typed out; omit for a narration-only beat */
  run?: string;
  /** output lines printed after the command (real, for captures; canned, for scripted demos) */
  out?: string[];
  /** seconds to hold after this step */
  pause_after?: number;
}

export interface CaseStudy {
  id: string;
  title: string;
  /** one-line description for cards and headers */
  summary: string;
  /** the "why": what this scenario demonstrates and why it matters */
  purpose?: string;
  tags?: string[];
  /** true when the steps came from a real capture rather than a hand-authored script */
  recorded?: boolean;
  /** provenance: the recording file a captured case study came from */
  recordingFile?: string;
  /** total run length in seconds (from a capture, or estimated for scripts) */
  durationSec?: number;
  terminals: Terminal[];
  steps: Step[];
}

// ── Live view ──────────────────────────────────────────────────────────────
// State the /live page renders. Today it is served by a simulated engine (lib/liveSim.ts) so the
// page is genuinely alive; the same shape is what a real orchestrator + Guacamole broker will return.

export interface LiveActor {
  id: string;
  role: Role;
  title: string;
}

export interface LiveEvent {
  t: number; // seconds since this run started
  actor: string;
  role: Role;
  kind: "narration" | "command" | "output" | "detection";
  text: string;
}

export interface LiveSession {
  caseStudyId: string;
  title: string;
  summary: string;
  startedAt: number; // epoch ms
  elapsedSec: number;
  durationSec: number;
  currentStep: number;
  totalSteps: number;
  actors: LiveActor[];
  /** id of the actor currently acting — the VM screen the live view foregrounds */
  activeActor: string;
  /** most recent events across all actors, newest last */
  activity: LiveEvent[];
  /** rolling console lines for the foregrounded VM screen */
  screen: { actor: string; role: Role; title: string; lines: string[] };
}

export interface QueueItem {
  id: string;
  caseStudyId: string;
  title: string;
  queuedAt: number;
  requestedBy: string;
}

export interface LiveState {
  now: number;
  live: LiveSession;
  queue: QueueItem[];
  /** whether live VM streaming is really wired up yet (Guacamole) or simulated */
  streamMode: "simulated" | "guacamole";
}
