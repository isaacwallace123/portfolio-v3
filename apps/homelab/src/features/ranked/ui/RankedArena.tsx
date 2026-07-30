"use client";

import {
  Activity,
  BellRing,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Crosshair,
  FileClock,
  Loader2,
  Search,
  Server,
  Shield,
  Terminal,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  rankedCommand,
  rankedInspect,
  type ClusterEvent,
  type LiveRunView,
  type LiveTrace,
  type RunComponent,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import { COMMAND_HELP, parseConsoleCommand } from "../model/console";
import styles from "../ranked.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;
type RankedTool = "mission" | "console" | "metrics" | "activity" | "changes";

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
  "inspect logs checkout",
  "inspect deployments",
  "trace latest",
] as const;

const TOOLS = [
  { id: "mission", label: "Mission", icon: Crosshair },
  { id: "console", label: "Console", icon: Terminal },
  { id: "metrics", label: "Metrics", icon: Activity },
  { id: "activity", label: "Events", icon: BellRing },
  { id: "changes", label: "Changes", icon: FileClock },
] as const;

export function RankedArena({
  run,
  busy,
  act,
  components,
  events,
  trace,
  selection,
  onSelect,
}: {
  run: LiveRunView;
  busy: string | null;
  act: Act;
  components: RunComponent[];
  events: ClusterEvent[];
  trace: LiveTrace | null;
  selection: string | null;
  onSelect: (selection: string | null) => void;
}) {
  const [activeTool, setActiveTool] = useState<RankedTool | null>("mission");
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([
    {
      id: 0,
      tone: "system",
      lines: [
        "Connected to the isolated arena.",
        "Investigate measured evidence, then operate through the audited allowlist. Type help for commands.",
      ],
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
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

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTool(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

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
      case "inspect": {
        append(parsed.query, ["Reading measured cluster evidence…"], "system");
        act(`inspect:${parsed.query}`, async () => {
          const evidence = await rankedInspect(run.runId, parsed.query);
          append(undefined, evidence.lines);
        });
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
  const warningEvents = events.filter((event) => event.severity === "warning");
  const selectedService = selection?.split(":")[0] ?? null;
  const activeMeta = TOOLS.find((tool) => tool.id === activeTool);

  return (
    <div className={styles.arenaChrome}>
      <div className={styles.matchClock} aria-label="Ranked match elapsed time">
        <Clock3 size={13} />
        <span>{clock(run.elapsedMs)}</span>
        <small>match time</small>
      </div>

      <nav className={styles.toolDock} aria-label="Ranked workspace tools">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-label={label}
            className={activeTool === id ? styles.toolActive : ""}
            aria-label={label}
            aria-pressed={activeTool === id}
            onClick={() =>
              setActiveTool((current) => (current === id ? null : id))
            }
          >
            <Icon size={16} />
            {id === "activity" && warningEvents.length > 0 && (
              <i>{warningEvents.length}</i>
            )}
          </button>
        ))}
      </nav>

      {activeTool && activeMeta && (
        <section
          className={styles.floatingPanel}
          data-tool={activeTool}
          aria-label={`${activeMeta.label} panel`}
        >
          <header className={styles.floatingPanelHeader}>
            <div>
              <span>{activeMeta.label}</span>
              <small>
                {activeTool === "mission"
                  ? `Escalation ${run.drillStage} of ${run.drillStageCount}`
                  : activeTool === "console"
                    ? "Allowlisted · audited"
                    : activeTool === "metrics"
                      ? "Measured cluster state"
                      : activeTool === "activity"
                        ? `${events.length} Kubernetes events`
                        : `${run.rankedActions.length} accepted mutations`}
              </small>
            </div>
            <button
              type="button"
              onClick={() => setActiveTool(null)}
              aria-label={`Close ${activeMeta.label}`}
            >
              <X size={15} />
            </button>
          </header>

          {activeTool === "mission" && (
            <div className={styles.missionPanel}>
              <section className={styles.incident}>
                <div className={styles.incidentTop}>
                  <span>
                    <Shield size={12} /> Rated incident
                  </span>
                  <b>live</b>
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
                        Commitment{" "}
                        <code>{briefing.seedCommitment.slice(0, 12)}</code>
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
                  <div
                    key={goal.label}
                    className={goal.met ? styles.goalMet : ""}
                  >
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
                  <div
                    className={styles.holdBar}
                    aria-label="Verification progress"
                  >
                    <i style={{ width: `${holdProgress * 100}%` }} />
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTool === "console" && (
            <section className={styles.console}>
              <div
                className={styles.quickReads}
                aria-label="Investigation shortcuts"
              >
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

              <div
                className={styles.transcript}
                ref={transcript}
                aria-live="polite"
              >
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
                  {busy?.startsWith("command:") ||
                  busy?.startsWith("inspect:") ? (
                    <Loader2 size={12} className={styles.spin} />
                  ) : (
                    "Run"
                  )}
                </button>
              </form>
            </section>
          )}

          {activeTool === "metrics" && (
            <div className={styles.metricsPanel}>
              <div className={styles.metricsSummary}>
                <div>
                  <span>Served / offered</span>
                  <b>
                    {run.telemetry.requestsPerSec} / {run.offeredRequestsPerSec}
                    /s
                  </b>
                </div>
                <div>
                  <span>p95 latency</span>
                  <b>{run.telemetry.p95LatencyMs}ms</b>
                </div>
                <div>
                  <span>Error rate</span>
                  <b>{run.telemetry.errorRatePct.toFixed(2)}%</b>
                </div>
                <div>
                  <span>Latest trace</span>
                  <b>{trace ? `${trace.durationMs}ms` : "Awaiting sample"}</b>
                </div>
              </div>
              <div className={styles.serviceList}>
                {components
                  .filter((component) => component.desired > 0)
                  .map((component) => (
                    <button
                      key={component.name}
                      type="button"
                      data-selected={selectedService === component.name}
                      onClick={() =>
                        onSelect(
                          selectedService === component.name
                            ? null
                            : component.name,
                        )
                      }
                    >
                      <i>
                        <Server size={13} />
                      </i>
                      <span>
                        <b>{component.name}</b>
                        <small>
                          {component.ready}/{component.desired} replicas ready
                        </small>
                      </span>
                      <em>
                        {component.cpuMillicores}m · {component.memoryMiB}Mi
                      </em>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {activeTool === "activity" && (
            <div className={styles.eventPanel}>
              {events.length === 0 ? (
                <p>No Kubernetes events have been observed yet.</p>
              ) : (
                events
                  .slice()
                  .reverse()
                  .slice(0, 30)
                  .map((event) => (
                    <article
                      key={event.id}
                      data-warning={event.severity === "warning"}
                    >
                      <i />
                      <div>
                        <header>
                          <b>{event.reason}</b>
                          <span>{event.objectKind}</span>
                        </header>
                        <p>{event.message}</p>
                        <small>{event.source}</small>
                      </div>
                    </article>
                  ))
              )}
            </div>
          )}

          {activeTool === "changes" && (
            <div className={styles.changePanel}>
              {run.rankedActions.length === 0 ? (
                <p>
                  No cluster mutations accepted. Your investigation reads do not
                  alter the environment.
                </p>
              ) : (
                run.rankedActions
                  .slice()
                  .reverse()
                  .map((action) => (
                    <article key={action.id}>
                      <span>{clock(action.acceptedAtMs)}</span>
                      <code>{action.command}</code>
                      <small>stage {action.stage}</small>
                    </article>
                  ))
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
