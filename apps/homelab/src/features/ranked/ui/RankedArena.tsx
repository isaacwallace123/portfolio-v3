"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Loader2,
  Search,
  Shield,
  Square,
  Terminal,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  endDrill,
  rankedCommand,
  type ClusterEvent,
  type LiveRunView,
  type LiveTrace,
  type RunComponent,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import {
  COMMAND_HELP,
  eventsOutput,
  metricsOutput,
  parseConsoleCommand,
  podsOutput,
  traceOutput,
} from "../model/console";
import styles from "../ranked.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

interface ConsoleEntry {
  id: number;
  command?: string;
  lines: string[];
  tone?: "system" | "accepted";
}

const QUICK_READS = [
  "inspect metrics",
  "inspect events --warnings",
  "inspect pods",
  "trace latest",
] as const;

export function RankedArena({
  run,
  components,
  events,
  trace,
  busy,
  act,
}: {
  run: LiveRunView;
  components: RunComponent[];
  events: ClusterEvent[];
  trace: LiveTrace | null;
  busy: string | null;
  act: Act;
}) {
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([
    {
      id: 0,
      tone: "system",
      lines: [
        "Connected to the isolated arena.",
        "Investigate live evidence, then operate through the server allowlist. Type help for commands.",
      ],
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [forfeit, setForfeit] = useState(false);
  const nextId = useRef(1);
  const transcript = useRef<HTMLDivElement>(null);
  const announcedStage = useRef(0);

  useEffect(() => {
    if (run.drillStage <= announcedStage.current) return;
    announcedStage.current = run.drillStage;
    const handoff =
      run.drillStage > 1 && run.drillStageHandoff
        ? run.drillStageHandoff
        : "New objective received. The fault has not been disclosed.";
    setEntries((current) => [
      ...current,
      {
        id: nextId.current++,
        tone: "system",
        lines: [`Escalation ${run.drillStage}/${run.drillStageCount}`, handoff],
      },
    ]);
  }, [run.drillStage, run.drillStageCount, run.drillStageHandoff]);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries]);

  const append = (
    command: string | undefined,
    lines: string[],
    tone?: ConsoleEntry["tone"],
  ) =>
    setEntries((current) => [
      ...current,
      { id: nextId.current++, command, lines, tone },
    ]);

  const execute = (raw: string) => {
    const parsed = parseConsoleCommand(raw);
    const normalized =
      parsed.kind === "remote" ? parsed.command : raw.trim().toLowerCase();
    if (normalized) {
      setCommandHistory((current) => [
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
        append(raw.trim() || "help", [...COMMAND_HELP]);
        return;
      case "metrics":
        append(normalized, metricsOutput(run, components, parsed.service));
        return;
      case "events":
        append(normalized, eventsOutput(events, parsed.warningsOnly));
        return;
      case "pods":
        append(normalized, podsOutput(components, parsed.service));
        return;
      case "trace":
        append(normalized, traceOutput(trace));
        return;
      case "history": {
        const lines = run.rankedActions.map(
          (action) => `${clock(action.acceptedAtMs)}  ${action.command}`,
        );
        append(
          normalized,
          lines.length > 0 ? lines : ["No mutations accepted yet."],
        );
        return;
      }
      case "remote":
        append(
          parsed.command,
          ["Submitting to the ranked control plane…"],
          "system",
        );
        act(`command:${parsed.command}`, async () => {
          const next = await rankedCommand(run.runId, parsed.command);
          append(
            undefined,
            [
              `Accepted: ${parsed.command}`,
              "Requested state recorded. Watch measured telemetry for convergence.",
            ],
            "accepted",
          );
          return next;
        });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || busy !== null) return;
    execute(input);
    setInput("");
  };

  const allGoalsMet =
    run.drillGoals.length > 0 && run.drillGoals.every((goal) => goal.met);
  const holdProgress =
    run.drillHoldSeconds > 0
      ? Math.min(1, run.drillHeldSeconds / run.drillHoldSeconds)
      : 0;
  const briefing = run.rankedBriefing;

  return (
    <div className={styles.arena}>
      <section className={styles.incident}>
        <div className={styles.incidentTop}>
          <span>
            <Shield size={12} /> Rated incident
          </span>
          <b>
            {clock(run.elapsedMs)} <small>elapsed</small>
          </b>
        </div>
        <div className={styles.stageLine}>
          <span>
            Escalation {run.drillStage} / {run.drillStageCount}
          </span>
          <div>
            {Array.from({ length: run.drillStageCount }, (_, index) => (
              <i
                key={index}
                className={
                  index + 1 < run.drillStage
                    ? styles.stageDone
                    : index + 1 === run.drillStage
                      ? styles.stageLive
                      : ""
                }
              />
            ))}
          </div>
        </div>
        <h2>{run.drillTitle}</h2>
        <p>{run.drillStageObjective || run.drillObjective}</p>
        {briefing && (
          <>
            <div className={styles.matchReceipt}>
              <span>
                Seed <code>{briefing.seedId.slice(0, 12)}</code>
              </span>
              <span>
                Generator <b>v{briefing.generatorVersion}</b>
              </span>
              <span>
                Cut for <b>{briefing.scenarioRating} ELO</b>
              </span>
              <span>
                Hold <b>{briefing.verificationHoldSeconds}s</b>
              </span>
            </div>
            <details className={styles.matchConstraints}>
              <summary>Environment and match constraints</summary>
              <p>{briefing.environment}</p>
              <ul>
                {briefing.constraints.map((constraint) => (
                  <li key={constraint}>{constraint}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      <section className={styles.objectiveGrid}>
        <header>
          <span>
            <CircleDot size={11} /> Measured objective
          </span>
          {allGoalsMet ? (
            <b className={styles.verifying}>
              <Loader2 size={11} className={styles.spin} /> verifying{" "}
              {run.drillHeldSeconds}/{run.drillHoldSeconds}s
            </b>
          ) : (
            <b>live</b>
          )}
        </header>
        {run.drillGoals.map((goal) => (
          <div key={goal.label} className={goal.met ? styles.goalMet : ""}>
            {goal.met ? <Check size={12} /> : <Clock3 size={12} />}
            <span>
              <b>{goal.label}</b>
              <small>
                {goal.current} / {goal.target}
              </small>
            </span>
          </div>
        ))}
        {allGoalsMet && (
          <div className={styles.holdBar} aria-label="Verification progress">
            <i style={{ width: `${holdProgress * 100}%` }} />
          </div>
        )}
      </section>

      <section className={styles.console}>
        <header>
          <span>
            <Terminal size={12} /> Operator console
          </span>
          <em>allowlisted · audited</em>
        </header>

        <div className={styles.quickReads} aria-label="Investigation shortcuts">
          {QUICK_READS.map((command) => (
            <button
              key={command}
              type="button"
              onClick={() => execute(command)}
              disabled={busy !== null}
            >
              <Search size={10} /> {command.replace("inspect ", "")}
            </button>
          ))}
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
                const next = Math.min(
                  commandHistory.length - 1,
                  historyIndex + 1,
                );
                if (next >= 0) {
                  setHistoryIndex(next);
                  setInput(commandHistory[next] ?? "");
                }
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                const next = historyIndex - 1;
                setHistoryIndex(next);
                setInput(next >= 0 ? (commandHistory[next] ?? "") : "");
              }
            }}
            placeholder="inspect metrics checkout"
            autoComplete="off"
            spellCheck={false}
            aria-label="Ranked operator command"
            disabled={busy !== null}
          />
          <button type="submit" disabled={busy !== null || !input.trim()}>
            {busy?.startsWith("command:") ? (
              <Loader2 size={12} className={styles.spin} />
            ) : (
              "Run"
            )}
          </button>
        </form>
      </section>

      <section className={styles.actionLog}>
        <header>
          <span>Server action log</span>
          <b>{run.rankedActions.length}</b>
        </header>
        {run.rankedActions.length === 0 ? (
          <p>No cluster mutations accepted.</p>
        ) : (
          run.rankedActions
            .slice()
            .reverse()
            .map((action) => (
              <div key={action.id}>
                <time>{clock(action.acceptedAtMs)}</time>
                <code>{action.command}</code>
              </div>
            ))
        )}
      </section>

      {forfeit ? (
        <div className={styles.forfeitBox}>
          <p>
            <AlertTriangle size={12} /> This records a rated loss.
          </p>
          <div>
            <button type="button" onClick={() => setForfeit(false)}>
              Stay in match
            </button>
            <button
              type="button"
              onClick={() => act("end", () => endDrill(run.runId))}
              disabled={busy !== null}
            >
              Confirm forfeit
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.forfeitButton}
          onClick={() => setForfeit(true)}
        >
          <Square size={11} /> Forfeit match
        </button>
      )}
    </div>
  );
}
