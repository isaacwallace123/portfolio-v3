// The operator console's vocabulary.
//
// One allowlist, shared by Ranked and by the Academy, because they are the same platform: an
// operator who learns `scale checkout 4` in a lesson has to be able to type it in a rated match.
// Two vocabularies would make the course teach a dialect.
//
// Nothing here decides what a command DOES. Parsing is local only far enough to route a line —
// help and clear never leave the browser, reads go to the inspect endpoint, and everything else is
// handed to the server verbatim, which owns the real allowlist and is the only thing that can
// accept or refuse it.

export type LocalCommand =
  | { kind: "help"; topic: string | null }
  | { kind: "clear" }
  | { kind: "inspect"; query: string }
  | { kind: "remote"; command: string };

export interface CommandDoc {
  /** What to type. Angle brackets are ranges the server enforces. */
  usage: string;
  /** What it does to the platform, in one line. */
  effect: string;
}

export interface CommandGroup {
  id: "investigate" | "operate";
  title: string;
  /** Why an operator reaches for this group at all. */
  purpose: string;
  commands: CommandDoc[];
}

/**
 * Reads are free and changes are not.
 *
 * The split is the console's one piece of teaching: investigation costs nothing and never alters
 * the environment, while every line in the second group is a real mutation of a real cluster that
 * the platform records against you. Presenting them as one undifferentiated list is what made the
 * old help read as a syntax dump.
 */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    id: "investigate",
    title: "Investigate",
    purpose:
      "Read-only. These change nothing and cost nothing — look before you act.",
    commands: [
      {
        usage: "inspect metrics [service]",
        effect:
          "Served vs offered, p95, errors. With a service: its replicas, CPU against limit, restarts.",
      },
      {
        usage: "inspect events [--warnings]",
        effect:
          "Real Kubernetes events from the namespace. --warnings drops the noise.",
      },
      {
        usage: "inspect pods [service]",
        effect: "Per-pod phase, readiness, worker pool, and resource use.",
      },
      {
        usage: "inspect logs [service]",
        effect: "Recent lines from the two healthiest pods of a service.",
      },
      {
        usage: "inspect deployments",
        effect:
          "Desired, updated, ready, and unavailable per Deployment — how a rollout is converging.",
      },
      {
        usage: "trace latest",
        effect:
          "The most recent distributed trace, span by span, with the release that served it.",
      },
      { usage: "history", effect: "Every change you have made, in order." },
    ],
  },
  {
    id: "operate",
    title: "Operate",
    purpose:
      "Real changes to a real cluster. Applied immediately; measured a few seconds later.",
    commands: [
      {
        usage: "scale checkout <1-6>",
        effect:
          "Replicas of the application tier. Each one has its own CPU limit, so this is throughput.",
      },
      {
        usage: "scale gateway <1-3>",
        effect: "Envoy replicas — the front door requests queue at.",
      },
      {
        usage: "shift canary <0-3>",
        effect:
          "Replicas serving the candidate build beside the stable fleet. 0 pulls it.",
      },
      {
        usage: "enable cache | disable cache",
        effect:
          "The Redis response tier. A hit skips the per-request CPU cost entirely.",
      },
      {
        usage: "rollback checkout",
        effect: "Return the stable track to the last known-good build.",
      },
      {
        usage: "recover catalogue",
        effect: "Restore the data tier from its clean snapshot.",
      },
      {
        usage: "set database connections <1-16>",
        effect: "Postgres connections per checkout pod. Eight is the norm.",
      },
      {
        usage: "restore database network",
        effect: "Reapply the allowlisted checkout-to-Postgres egress policy.",
      },
      {
        usage: "drain apps | drain infra",
        effect: "Move the fleet to the other worker pool. Pods are replaced.",
      },
      {
        usage: "restart checkout",
        effect:
          "Roll the application tier. Warm capacity is lost while it does.",
      },
    ],
  },
];

const CONSOLE_COMMANDS: readonly CommandDoc[] = [
  { usage: "help [investigate|operate]", effect: "This list." },
  { usage: "clear", effect: "Empty the transcript. Changes nothing." },
];

/** Rendered help, as transcript lines. A topic narrows it to one group. */
export function helpLines(topic: string | null): string[] {
  const groups = topic
    ? COMMAND_GROUPS.filter((group) => group.id === topic)
    : COMMAND_GROUPS;
  const width = Math.max(
    ...groups.flatMap((group) => group.commands.map((c) => c.usage.length)),
    ...(topic ? [0] : CONSOLE_COMMANDS.map((c) => c.usage.length)),
  );
  const pad = (usage: string) => usage.padEnd(width, " ");

  const lines: string[] = [];
  for (const group of groups) {
    lines.push(`${group.title.toUpperCase()} — ${group.purpose}`);
    for (const command of group.commands)
      lines.push(`  ${pad(command.usage)}   ${command.effect}`);
    lines.push("");
  }
  if (!topic) {
    lines.push("CONSOLE");
    for (const command of CONSOLE_COMMANDS)
      lines.push(`  ${pad(command.usage)}   ${command.effect}`);
    lines.push("");
    lines.push(
      "Square brackets are optional, angle brackets are ranges. Up and down arrows walk your history.",
    );
  }
  return lines;
}

/** Shown once when a console opens, so the prompt is never a blank invitation. */
export const CONSOLE_GREETING = [
  "Connected to the isolated arena.",
  "Read the platform with inspect, then change it with an operator command. Type help for both lists.",
];

const HELP_TOPICS = new Set<string>(COMMAND_GROUPS.map((group) => group.id));

export function parseConsoleCommand(input: string): LocalCommand {
  const command = input.trim().toLowerCase().replace(/\s+/g, " ");
  const words = command.split(" ");

  if (!command || words[0] === "help")
    return {
      kind: "help",
      topic: HELP_TOPICS.has(words[1] ?? "") ? (words[1] ?? null) : null,
    };
  if (command === "clear") return { kind: "clear" };
  if (
    command === "history" ||
    command === "trace latest" ||
    words[0] === "inspect"
  )
    return { kind: "inspect", query: command };
  return { kind: "remote", command };
}
