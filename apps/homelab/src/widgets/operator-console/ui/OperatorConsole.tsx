"use client";

import { ChevronRight, Loader2, Search } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { LiveError } from "@/shared/api/live-client";
import {
  CONSOLE_GREETING,
  helpLines,
  parseConsoleCommand,
} from "../model/console";
import styles from "./operator-console.module.css";

export interface ConsoleEntry {
  id: number;
  command?: string;
  lines: string[];
  tone?: "system" | "accepted" | "refused";
}

/** What a host can push into the transcript from outside — a stage handoff, a lesson prompt. */
export interface ConsoleHandle {
  announce: (lines: string[]) => void;
}

const QUICK_READS = [
  "inspect metrics",
  "inspect events --warnings",
  "inspect pods",
  "inspect logs checkout",
  "inspect deployments",
  "trace latest",
] as const;

/**
 * Why the control plane said no, in the console that asked.
 *
 * Every refusal along this path is a sentence written to be read by an operator — the allowlist,
 * an action ceiling, a sealed match, a rate limit. Showing it beats the alternative, which is a
 * transcript that says "submitting…" and then stops, and is indistinguishable from a console that
 * does not work.
 */
function refusal(cause: unknown): string {
  if (cause instanceof LiveError)
    return `Refused (${cause.status}): ${cause.message}`;
  if (cause instanceof Error) return `Refused: ${cause.message}`;
  return "Refused: the control plane did not answer.";
}

/**
 * The operator console.
 *
 * Shared between the competitive arena and the Academy on purpose: they are the same platform, and
 * a course that taught a different vocabulary from the one a rated match accepts would be teaching
 * a dialect. What differs between the two surfaces is what the server does with a line — Ranked
 * audits it against an attempt, the Academy does not — so this component owns the transcript, the
 * history, and the vocabulary, and knows nothing about either mode.
 */
export function OperatorConsole({
  busy,
  onInspect,
  onCommand,
  handle,
  greeting = CONSOLE_GREETING,
}: {
  /** The host's in-flight key, or null. The console disables itself while one is running. */
  busy: string | null;
  /** Run a read. Resolves to the evidence lines the server measured. */
  onInspect: (query: string) => Promise<string[]>;
  /** Apply a change. Rejects with a LiveError the transcript can quote. */
  onCommand: (command: string) => Promise<void>;
  handle?: RefObject<ConsoleHandle | null>;
  greeting?: readonly string[];
}) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([
    { id: 0, tone: "system", lines: [...greeting] },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState<string | null>(null);
  const nextId = useRef(1);
  const transcript = useRef<HTMLDivElement>(null);

  const append = (
    command: string | undefined,
    lines: string[],
    tone?: ConsoleEntry["tone"],
  ) =>
    setEntries((current) => [
      ...current,
      { id: nextId.current++, command, lines, tone },
    ]);

  useImperativeHandle(handle, () => ({
    announce: (lines: string[]) => append(undefined, lines, "system"),
  }));

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries]);

  const disabled = busy !== null || running !== null;

  const execute = (raw: string) => {
    const parsed = parseConsoleCommand(raw);
    const normalized =
      parsed.kind === "remote" ? parsed.command : raw.trim().toLowerCase();
    if (normalized) {
      setHistory((current) => [
        normalized,
        ...current.filter((item) => item !== normalized),
      ]);
      setHistoryIndex(-1);
    }

    switch (parsed.kind) {
      case "clear":
        setEntries([]);
        return;
      case "help":
        append(raw.trim() || "help", helpLines(parsed.topic));
        return;
      case "inspect":
        append(parsed.query, ["Reading measured cluster evidence…"], "system");
        setRunning(parsed.query);
        onInspect(parsed.query)
          .then((lines) => append(undefined, lines))
          .catch((cause: unknown) =>
            append(undefined, [refusal(cause)], "refused"),
          )
          .finally(() => setRunning(null));
        return;
      case "remote":
        append(parsed.command, ["Submitting to the control plane…"], "system");
        setRunning(parsed.command);
        onCommand(parsed.command)
          .then(() =>
            append(
              undefined,
              [
                `Accepted: ${parsed.command}`,
                "Requested state recorded. Watch measured telemetry for convergence.",
              ],
              "accepted",
            ),
          )
          .catch((cause: unknown) =>
            append(undefined, [refusal(cause)], "refused"),
          )
          .finally(() => setRunning(null));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || disabled) return;
    execute(input);
    setInput("");
  };

  return (
    <section className={styles.console}>
      <div className={styles.quickReads} aria-label="Investigation shortcuts">
        {QUICK_READS.map((command) => (
          <button
            key={command}
            type="button"
            onClick={() => execute(command)}
            disabled={disabled}
          >
            <Search size={10} /> {command.replace("inspect ", "")}
          </button>
        ))}
        <button
          type="button"
          className={styles.helpShortcut}
          onClick={() => execute("help")}
          disabled={disabled}
        >
          help
        </button>
      </div>

      <div className={styles.transcript} ref={transcript} aria-live="polite">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`${styles.consoleEntry} ${
              entry.tone === "system"
                ? styles.consoleSystem
                : entry.tone === "accepted"
                  ? styles.consoleAccepted
                  : entry.tone === "refused"
                    ? styles.consoleRefused
                    : ""
            }`}
          >
            {entry.command && (
              <p>
                <ChevronRight size={11} /> {entry.command}
              </p>
            )}
            {entry.lines.map((line, index) => (
              <code key={`${entry.id}-${index}`}>{line}</code>
            ))}
          </div>
        ))}
      </div>

      <form className={styles.commandLine} onSubmit={submit}>
        <span>&gt;</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              const next = Math.min(history.length - 1, historyIndex + 1);
              if (next >= 0) {
                setHistoryIndex(next);
                setInput(history[next] ?? "");
              }
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              // Floored at -1, the empty line. Letting it run negative meant walking past the
              // newest entry took as many ArrowUps to get back as ArrowDowns you had pressed.
              const next = Math.max(-1, historyIndex - 1);
              setHistoryIndex(next);
              setInput(next >= 0 ? (history[next] ?? "") : "");
            }
          }}
          placeholder="help"
          autoComplete="off"
          spellCheck={false}
          aria-label="Operator command"
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || !input.trim()}>
          {running !== null ? (
            <Loader2 size={12} className={styles.spin} />
          ) : (
            "Run"
          )}
        </button>
      </form>
    </section>
  );
}
