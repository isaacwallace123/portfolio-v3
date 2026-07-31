"use client";

import {
  Activity,
  BellRing,
  Check,
  CircleDot,
  Clock3,
  Crosshair,
  FileClock,
  Loader2,
  Server,
  Shield,
  Terminal,
  X,
} from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  rankedCommand,
  rankedInspect,
  type ClusterEvent,
  type LiveRunView,
  type LiveTrace,
  type RunComponent,
} from "@/shared/api/live-client";
import { clock } from "@/shared/lib/format";
import {
  OperatorConsole,
  type ConsoleHandle,
} from "@/widgets/operator-console";
import type { Series } from "@/widgets/cluster-workbench/model/useClusterRun";
import { InspectorPanel } from "@/widgets/cluster-workbench/ui/InspectorPanel";
import styles from "../ranked.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;
type RankedTool = "mission" | "console" | "metrics" | "activity" | "changes";

const RANKED_GREETING = [
  "Connected to the isolated arena. This is a rated match.",
  "Every read is recorded as evidence and every change is audited against your attempt. Type help for both lists.",
];

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
  history,
  selection,
  onSelect,
}: {
  run: LiveRunView;
  busy: string | null;
  act: Act;
  components: RunComponent[];
  events: ClusterEvent[];
  trace: LiveTrace | null;
  /** Measured CPU and memory samples per service and per pod — what the trend charts are drawn from. */
  history: Series;
  selection: string | null;
  onSelect: (selection: string | null) => void;
}) {
  // The console opens first. It is the only way to change anything in a ranked match — the
  // practice controls column is not rendered on this surface — so defaulting to the briefing put
  // the entire operate loop behind an unlabelled icon.
  //
  // The selected tool and whether the panel is open are separate pieces of state so the panel can
  // be hidden rather than unmounted. The console's transcript is the operator's record of the
  // shift, and closing a panel to see the graph is not a reason to lose it.
  const [activeTool, setActiveTool] = useState<RankedTool>("console");
  const [panelOpen, setPanelOpen] = useState(true);
  const toolButtons = useRef<
    Partial<Record<RankedTool, HTMLButtonElement | null>>
  >({});
  const consoleRef = useRef<ConsoleHandle | null>(null);
  const announcedStage = useRef(0);

  useEffect(() => {
    if (run.drillStage <= announcedStage.current) return;
    const previous = announcedStage.current;
    announcedStage.current = run.drillStage;
    // Only a real escalation gets announced. The opening phase is not one: the ref starts at zero,
    // so without this the console greeted every match with "Escalation 1/N — new objective received"
    // before the operator had done anything. The same guard covers a resumed match, which arrives
    // already on its current phase rather than having advanced into it.
    if (run.drillStage <= 1 || previous === 0) return;
    consoleRef.current?.announce([
      `Escalation ${run.drillStage}/${run.drillStageCount}`,
      run.drillStageHandoff ||
        "New objective received. The fault has not been disclosed.",
    ]);
  }, [run.drillStage, run.drillStageCount, run.drillStageHandoff]);

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
  const panelId = "ranked-workspace-panel";
  const closeTool = () => {
    setPanelOpen(false);
    window.requestAnimationFrame(() =>
      toolButtons.current[activeTool]?.focus(),
    );
  };
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeTool();
  };

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
            ref={(node) => {
              toolButtons.current[id] = node;
            }}
            type="button"
            data-label={label}
            className={panelOpen && activeTool === id ? styles.toolActive : ""}
            aria-label={label}
            aria-pressed={panelOpen && activeTool === id}
            aria-expanded={panelOpen && activeTool === id}
            aria-controls={panelId}
            onClick={() => {
              if (activeTool === id) setPanelOpen((open) => !open);
              else {
                setActiveTool(id);
                setPanelOpen(true);
              }
            }}
          >
            <Icon size={15} />
            {/* Named, not just tooltipped. Five unlabelled glyphs meant the only way to find the
                metrics panel was to hover each one in turn — and the activity squiggle and the
                event bell are exactly the pair a first-time operator guesses wrong. */}
            <em>{label}</em>
            {id === "activity" && warningEvents.length > 0 && (
              <i>{warningEvents.length}</i>
            )}
          </button>
        ))}
      </nav>

      {activeMeta && (
        <section
          id={panelId}
          hidden={!panelOpen}
          className={styles.floatingPanel}
          data-tool={activeTool}
          aria-label={`${activeMeta.label} panel`}
          onKeyDown={closeOnEscape}
        >
          <header className={styles.floatingPanelHeader}>
            <div>
              <span>{activeMeta.label}</span>
              <small>
                {activeTool === "mission"
                  ? `Phase ${run.drillStage} of ${run.drillStageCount}`
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
              onClick={closeTool}
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
                    Phase {run.drillStage} / {run.drillStageCount}
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

          <div hidden={activeTool !== "console"} className={styles.consoleSlot}>
            <OperatorConsole
              busy={busy}
              handle={consoleRef}
              greeting={RANKED_GREETING}
              onInspect={async (query) => {
                const evidence = await rankedInspect(run.runId, query);
                return evidence.lines;
              }}
              onCommand={(command) =>
                new Promise<void>((resolve, reject) => {
                  // Routed through the host's `act` so the accepted frame lands in the same run
                  // state the graph and objective panel render from, and so a refusal still
                  // reaches the HUD banner. The console only needs to know whether it settled.
                  act(`command:${command}`, () =>
                    rankedCommand(run.runId, command).then(
                      (next) => {
                        resolve();
                        return next;
                      },
                      (cause: unknown) => {
                        reject(cause);
                        throw cause;
                      },
                    ),
                  );
                })
              }
            />
          </div>

          {activeTool === "metrics" && (
            <div className={styles.metricsPanel}>
              <div className={styles.metricsSummary}>
                <div>
                  <span>Served / offered</span>
                  <b>
                    {run.measuredTelemetry.requestsPerSec === null
                      ? "withheld"
                      : `${run.measuredTelemetry.requestsPerSec} / ${run.offeredRequestsPerSec}/s`}
                  </b>
                </div>
                <div>
                  <span>p95 latency</span>
                  <b>
                    {run.measuredTelemetry.p95LatencyMs === null
                      ? "withheld"
                      : `${run.measuredTelemetry.p95LatencyMs}ms`}
                  </b>
                </div>
                <div>
                  <span>Error rate</span>
                  <b>
                    {run.measuredTelemetry.errorRatePct === null
                      ? "withheld"
                      : `${run.measuredTelemetry.errorRatePct.toFixed(2)}%`}
                  </b>
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

              {/* The real instrument, not a summary of one.
                  The arena had a flat list of tiers and nothing else, while the practice surface
                  kept the measured trend charts, per-pod saturation against limit, restart counts,
                  the replica picker, and the trace spans in its inspector — none of which the
                  ranked surface renders, because it does not draw the right-hand aside at all.
                  Same component, same real samples; a competitor should not be reading a thinner
                  panel than a learner. */}
              {selection && (
                <div className={styles.inspectorSlot}>
                  <InspectorPanel
                    selection={selection}
                    components={components}
                    history={history}
                    trace={trace}
                    onSelect={onSelect}
                  />
                </div>
              )}
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
