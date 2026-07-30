export type LocalCommand =
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "inspect"; query: string }
  | { kind: "remote"; command: string };

export const COMMAND_HELP = [
  "inspect metrics [checkout|canary|gateway|cache|database]",
  "inspect events [--warnings]",
  "inspect pods [service]",
  "inspect logs [service]",
  "inspect deployments",
  "trace latest",
  "history",
  "scale checkout <1-6>",
  "scale gateway <1-3>",
  "shift canary <0-3>",
  "enable cache | disable cache",
  "rollback checkout",
  "recover catalogue",
  "set database connections <1-16>",
  "restore database network",
  "drain apps | drain infra",
  "restart checkout",
] as const;

export function parseConsoleCommand(input: string): LocalCommand {
  const command = input.trim().toLowerCase().replace(/\s+/g, " ");
  const words = command.split(" ");

  if (!command || command === "help") return { kind: "help" };
  if (command === "clear") return { kind: "clear" };
  if (
    command === "history" ||
    command === "trace latest" ||
    words[0] === "inspect"
  )
    return { kind: "inspect", query: command };
  return { kind: "remote", command };
}
