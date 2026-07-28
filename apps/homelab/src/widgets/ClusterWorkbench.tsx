"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  CircleSlash,
  Cpu,
  Database,
  Gauge,
  Layers,
  Loader2,
  Lock,
  MemoryStick,
  PartyPopper,
  Play,
  Radio,
  Server,
  SlidersHorizontal,
  Square,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AUTH_URL, HOMELAB_URL } from "@iw/core";
import { RangeSlider } from "@iw/ui";
import { homelabScenarios } from "@/entities/scenario";
import {
  createLiveRun,
  endDrill,
  fetchComponents,
  fetchLiveStatus,
  fetchPlatformStatus,
  fetchRunEvents,
  getLiveRun,
  getLiveTrace,
  liveDecision,
  practiceAction,
  renewRun,
  startDrill,
  teardownLiveRun,
  type ClusterEvent,
  type LivePlatformStatus,
  type LiveRunView,
  type LiveStatus,
  type LiveTrace,
  type RunComponent,
} from "@/shared/lib/liveClient";
import {
  countByLevel,
  LEVELS,
  levelOf,
  matches,
  phaseOf,
  PHASES,
  type Level,
  type Phase,
} from "@/shared/lib/activity";
import styles from "./ClusterWorkbench.module.css";

const SANDBOX = "practice-cluster";
const POLL_MS = 1200;
const HISTORY = 40; // ~100s of samples at the poll interval

const drills = homelabScenarios.filter((s) => s.id !== SANDBOX);

// The request graph. Explicit 1-based grid coordinates: the request tiers run along row 2, the data
// tier stacks in column 4 with Postgres above and Redis below.
// The services in the request path, laid out in columns. Every POD renders as its own card, so a
// checkout scaled to six shows six cards the gateway is balancing across — the graph grows with the
// workload instead of a replica counter changing.
const SERVICES = {
  k6: { label: "k6", role: "load generator", icon: Zap },
  envoy: { label: "Envoy", role: "gateway", icon: Radio },
  checkout: { label: "checkout", role: "API", icon: Server },
  postgres: { label: "Postgres", role: "database", icon: Database },
  redis: { label: "Redis", role: "cache", icon: Database },
} as const;

type ServiceId = keyof typeof SERVICES;

const COLUMNS: ServiceId[][] = [
  ["k6"],
  ["envoy"],
  ["checkout"],
  ["postgres", "redis"],
];

// Traffic flows column to column; edges are drawn card-to-card, so they fan out across replicas.
const FLOWS: [ServiceId, ServiceId][] = [
  ["k6", "envoy"],
  ["envoy", "checkout"],
  ["checkout", "postgres"],
  ["checkout", "redis"],
];

const withReplicas = (r: LiveRunView, n: number): LiveRunView => ({
  ...r,
  telemetry: { ...r.telemetry, apiReplicas: n },
});
const withCache = (r: LiveRunView, on: boolean): LiveRunView => ({
  ...r,
  telemetry: { ...r.telemetry, cacheActive: on },
});

// Allowlisted cluster controls. `apply` mirrors the broker's effect locally so a segment reflects the
// new state the instant it is clicked, rather than waiting a poll for the round trip.
// Continuous dials. The action id carries the exact value ("scale-4"); the API bounds it to the same
// range the XRD enforces, so a slider can never ask for something the platform would not allow.
const SLIDERS = [
  {
    label: "Checkout replicas",
    hint: "Each replica has its own CPU limit, so capacity scales with this and p95 falls under load.",
    min: 1,
    max: 6,
    prefix: "scale-",
    value: (r: LiveRunView) => r.telemetry.apiReplicas,
    apply: (r: LiveRunView, n: number) => withReplicas(r, n),
    unit: (n: number) => `${n} replica${n === 1 ? "" : "s"}`,
  },
  {
    label: "Load intensity",
    hint: "Each generator runs the same closed-loop script — more generators mean more concurrent users.",
    min: 0,
    max: 4,
    prefix: "load-",
    value: (r: LiveRunView) => r.loadGenerators,
    apply: (r: LiveRunView, n: number) => ({
      ...r,
      loadGenerators: n,
      loadEnabled: n > 0,
    }),
    unit: (n: number) => (n === 0 ? "no traffic" : `${n}× generator`),
  },
] as const;

const CONTROLS = [
  {
    label: "Cache tier",
    hint: "Redis in front of Postgres. A cache hit skips the request's work entirely.",
    active: (r: LiveRunView) =>
      r.telemetry.cacheActive ? "cache-on" : "cache-off",
    options: [
      {
        id: "cache-off",
        label: "Off",
        apply: (r: LiveRunView) => withCache(r, false),
      },
      {
        id: "cache-on",
        label: "On",
        apply: (r: LiveRunView) => withCache(r, true),
      },
    ],
  },
  {
    label: "Release track",
    hint: "The candidate build carries a real slow, occasionally failing pricing path.",
    active: (r: LiveRunView) => `release-${r.releaseTrack}`,
    options: [
      {
        id: "release-stable",
        label: "Stable",
        apply: (r: LiveRunView) => ({ ...r, releaseTrack: "stable" as const }),
      },
      {
        id: "release-candidate",
        label: "Candidate",
        apply: (r: LiveRunView) => ({
          ...r,
          releaseTrack: "candidate" as const,
        }),
      },
    ],
  },
  {
    label: "Worker pool",
    hint: "Which node pool the checkout replicas are scheduled onto.",
    active: (r: LiveRunView) => `move-${r.targetPool}`,
    options: [
      {
        id: "move-apps",
        label: "Apps",
        apply: (r: LiveRunView) => ({ ...r, targetPool: "apps" as const }),
      },
      {
        id: "move-infra",
        label: "Infra",
        apply: (r: LiveRunView) => ({ ...r, targetPool: "infra" as const }),
      },
    ],
  },
] as const;

function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** A line chart of real measured samples — a trend, not a dashboard. */
function Spark({
  series,
  label,
  unit,
}: {
  series: number[];
  label: string;
  unit: string;
}) {
  const max = Math.max(1, ...series);
  const last = series.at(-1) ?? 0;
  const w = 260;
  const h = 40;
  const d =
    series.length < 2
      ? ""
      : series
          .map((v, i) => {
            const x = (i / (series.length - 1)) * w;
            const y = h - (v / max) * (h - 4) - 2;
            return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(" ");

  return (
    <div className={styles.spark}>
      <div className={styles.sparkTop}>
        <span>{label}</span>
        <b>
          {last}
          {unit}
        </b>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {d && (
          <>
            <path
              d={`${d} L ${w} ${h} L 0 ${h} Z`}
              className={styles.sparkFill}
            />
            <path d={d} className={styles.sparkLine} />
          </>
        )}
      </svg>
      <small>
        peak {max}
        {unit} · {series.length} samples
      </small>
    </div>
  );
}

/** Purely decorative celebration for a solved drill: random confetti plus a few firework bursts.
    Generated once per mount so the randomness does not resample on every poll. */
function Celebration() {
  const [pieces] = useState(() =>
    Array.from({ length: 90 }, () => ({
      left: Math.random() * 100,
      delay: Math.random() * 1400,
      duration: 2200 + Math.random() * 2200,
      drift: Math.random() * 160 - 80,
      spin: Math.random() * 900 - 450,
      size: 5 + Math.random() * 7,
      hue: Math.floor(Math.random() * 3),
    })),
  );
  const [bursts] = useState(() =>
    Array.from({ length: 4 }, (_, i) => ({
      x: 18 + Math.random() * 64,
      y: 18 + Math.random() * 42,
      delay: i * 420 + Math.random() * 220,
      sparks: Array.from({ length: 16 }, (_, k) => ({
        angle: (k / 16) * 360 + Math.random() * 12,
        distance: 70 + Math.random() * 70,
      })),
    })),
  );

  return (
    <div className={styles.celebration} aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={styles[`c${p.hue}` as keyof typeof styles]}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      {bursts.map((b, i) => (
        <span
          key={i}
          className={styles.burst}
          style={{ left: `${b.x}%`, top: `${b.y}%` }}
        >
          {b.sparks.map((s, k) => (
            <em
              key={k}
              style={
                {
                  animationDelay: `${b.delay}ms`,
                  "--angle": `${s.angle}deg`,
                  "--dist": `${s.distance}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}

/** Toggle a value in a Set without mutating it. */
function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

type Tab = "drills" | "controls" | "activity";
const TABS: { id: Tab; icon: typeof Gauge; label: string }[] = [
  { id: "drills", icon: Gauge, label: "Drills" },
  { id: "controls", icon: SlidersHorizontal, label: "Controls" },
  { id: "activity", icon: Layers, label: "Activity" },
];

export default function ClusterWorkbench() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [components, setComponents] = useState<RunComponent[]>([]);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [history, setHistory] = useState<
    Record<string, { cpu: number; mem: number }[]>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drills");
  const [levels, setLevels] = useState<Set<Level>>(new Set());
  const [phases, setPhases] = useState<Set<Phase>>(new Set());
  const [query, setQuery] = useState("");
  const [renewalDismissed, setRenewalDismissed] = useState(false);
  const [expired, setExpired] = useState(false);

  // Ticks once a second so the countdown and elapsed clock move smoothly between polls.
  const [now, setNow] = useState(() => Date.now());
  const poll = useRef<number | null>(null);
  // Every mutation bumps this. A refresh captures it before fetching and drops its run payload if a
  // mutation happened meanwhile — otherwise an in-flight poll lands after an action and reverts it.
  const mutationSeq = useRef(0);
  // The cluster this page is currently attached to. A poll started before a teardown would otherwise
  // land afterwards and put the torn-down cluster straight back on screen — which is exactly what
  // "it comes back three seconds later" was. Cleared the moment the cluster is given up.
  const attached = useRef<string | null>(null);

  // ── edges measured from the real node boxes, so the graph is correct at any width ──
  const canvasRef = useRef<HTMLDivElement | null>(null);
  // One entry per rendered card ("checkout:abc12"), so edges can be drawn between individual pods.
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [paths, setPaths] = useState<{ id: string; d: string }[]>([]);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = canvas.getBoundingClientRect();
    const next: { id: string; d: string }[] = [];

    const curve = (from: DOMRect, to: DOMRect, id: string) => {
      const x1 = from.right - base.left;
      const y1 = from.top + from.height / 2 - base.top;
      const x2 = to.left - base.left;
      const y2 = to.top + to.height / 2 - base.top;
      const dx = Math.max(24, (x2 - x1) * 0.55);
      next.push({
        id,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
    };

    // Every card of the upstream service connects to every card of the downstream one, which is what
    // per-request load balancing actually looks like.
    for (const [from, to] of FLOWS) {
      const sources = Object.entries(cardRefs.current).filter(
        ([k, el]) => el && k.startsWith(`${from}:`),
      );
      const targets = Object.entries(cardRefs.current).filter(
        ([k, el]) => el && k.startsWith(`${to}:`),
      );
      for (const [sk, sel] of sources)
        for (const [tk, tel] of targets)
          curve(
            sel!.getBoundingClientRect(),
            tel!.getBoundingClientRect(),
            `${sk}->${tk}`,
          );
    }
    setPaths(next);
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, components, run?.runId]);

  // ── data ──────────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (poll.current !== null) {
      window.clearInterval(poll.current);
      poll.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  // Let go of the current cluster and return to the launch screen. One place, so teardown, expiry
  // and "the API says it is being deleted" cannot each get it subtly different.
  const release = useCallback(() => {
    attached.current = null;
    setRenewalDismissed(false);
    stopPolling();
    setRun(null);
    setComponents([]);
    setEvents([]);
    setTrace(null);
    setHistory({});
    setSelected(null);
    setStatus((s) => (s ? { ...s, myRunId: null } : s));
  }, [stopPolling]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(
    async (runId: string) => {
      const seq = mutationSeq.current;
      const [view, comps, evts, tr] = await Promise.all([
        getLiveRun(runId),
        fetchComponents(runId).catch(() => [] as RunComponent[]),
        fetchRunEvents(runId).catch(() => [] as ClusterEvent[]),
        getLiveTrace(runId).catch(() => null),
      ]);
      // The page moved on while this was in flight — drop the whole payload.
      if (attached.current !== runId) return;
      // A cluster being deleted is gone as far as the page is concerned: the API still answers for it
      // until Crossplane finishes collecting the namespace, and adopting that answer is what used to
      // resurrect a torn-down cluster.
      if (view.deleting) {
        release();
        return;
      }
      // Out of time. The platform reaper deletes the LabRun on the same deadline, so the page lets
      // go here rather than leaving a dead cluster on screen with its timer frozen at zero.
      if (view.remainingTtlMs <= 0) {
        release();
        setExpired(true);
        return;
      }
      // Measured data is always safe to apply; desired state is not if it raced a mutation.
      if (seq === mutationSeq.current) setRun(view);
      setComponents(comps);
      setEvents(evts);
      setTrace(tr);
      // Track a trend for the service as a whole AND for each pod, so the inspector can graph whichever
      // one is selected.
      setHistory((prev) => {
        const next = { ...prev };
        const push = (key: string, cpu: number, mem: number) => {
          next[key] = [...(next[key] ?? []), { cpu, mem }].slice(-HISTORY);
        };
        for (const c of comps) {
          push(c.name, c.cpuMillicores, c.memoryMiB);
          for (const p of c.pods)
            push(`${c.name}:${p.name}`, p.cpuMillicores, p.memoryMiB);
        }
        return next;
      });
    },
    [release],
  );

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling();
      attached.current = runId;
      poll.current = window.setInterval(() => {
        refresh(runId).catch(() => stopPolling());
      }, POLL_MS);
    },
    [refresh, stopPolling],
  );

  // Resume the cluster this account already owns. The first paint is a skeleton rather than the
  // launch screen, so a reload never flashes "provision a cluster" at someone who already has one.
  useEffect(() => {
    let alive = true;
    fetchLiveStatus()
      .then(async (s) => {
        if (!alive) return;
        if (s.myRunId) {
          attached.current = s.myRunId;
          await refresh(s.myRunId).catch(() => undefined);
          if (!alive) return;
          startPolling(s.myRunId);
        }
        setStatus(s);
      })
      .catch(() => {
        if (alive)
          setStatus({
            enabled: false,
            signedIn: false,
            displayName: null,
            myRunId: null,
          });
      });
    fetchPlatformStatus()
      .then((p) => alive && setPlatform(p))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refresh, startPolling]);

  const act = useCallback(
    async (
      key: string,
      fn: () => Promise<LiveRunView | void>,
      optimistic?: (r: LiveRunView) => LiveRunView,
    ) => {
      setBusy(key);
      setError(null);
      mutationSeq.current += 1;
      if (optimistic) setRun((r) => (r ? optimistic(r) : r));
      try {
        const next = await fn();
        mutationSeq.current += 1;
        if (next) setRun(next as LiveRunView);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That action was rejected.");
        mutationSeq.current += 1;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const provision = useCallback(async () => {
    setBusy("provision");
    setError(null);
    try {
      const created = await createLiveRun(SANDBOX);
      setRun(created);
      setExpired(false);
      startPolling(created.runId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not provision a cluster.",
      );
    } finally {
      setBusy(null);
    }
  }, [startPolling]);

  const renew = useCallback(async () => {
    if (!run) return;
    await act("renew", () => renewRun(run.runId));
    setRenewalDismissed(true);
  }, [act, run]);

  const teardown = useCallback(async () => {
    if (!run) return;
    setBusy("teardown");
    // Detach first: the cluster is given up the moment the request goes out, so nothing that is
    // already in flight can put it back.
    release();
    try {
      await teardownLiveRun(run.runId);
      fetchPlatformStatus()
        .then(setPlatform)
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Teardown failed.");
    } finally {
      setBusy(null);
    }
  }, [run, release]);

  const byName = (n: string) => components.find((c) => c.name === n);

  // What the operator has asked for. This is known the instant a slider moves, whereas the
  // Deployment's own desired count only catches up a round-trip later — so the graph draws a card
  // per intended replica immediately, and the ones that do not exist yet render as ghosts. Watching
  // six squares appear and fill in is the feedback; waiting on two squares is not.
  const intendedPods = (svc: ServiceId): number => {
    if (!run) return 0;
    switch (svc) {
      case "checkout":
        return run.telemetry.apiReplicas;
      case "k6":
        return run.loadGenerators;
      case "redis":
        return run.telemetry.cacheActive ? 1 : 0;
      default:
        return 1;
    }
  };

  // A replica the cluster has refused to create — quota exhausted, nothing schedulable. Without
  // this a ghost card spins on "requesting…" forever and reads as slowness, when the cluster has
  // actually already answered and the answer was no.
  const blockedReason = (svc: ServiceId): string | null => {
    const hit = events.find(
      (e) =>
        (e.reason === "FailedCreate" || e.reason === "FailedScheduling") &&
        e.message.includes(svc),
    );
    if (!hit) return null;
    return hit.message.includes("exceeded quota")
      ? "quota reached"
      : "cannot schedule";
  };

  // The one tier that is currently not where it was asked to be. Drives the banner so a change is
  // narrated from the click through to the last pod going ready, rather than being silent until it
  // finishes.
  const converging = (["checkout", "k6", "redis"] as ServiceId[])
    .map((svc) => ({
      svc,
      want: intendedPods(svc),
      have: byName(svc)?.pods.filter((p) => p.ready).length ?? 0,
    }))
    .find((x) => x.want !== x.have);

  // ── first paint: resolving the session ────────────────────────────────────
  if (status === null) {
    return (
      <div className={styles.shell}>
        <div className={styles.booting}>
          <Loader2 size={18} className={styles.spin} />
          <span>Looking for your cluster…</span>
        </div>
      </div>
    );
  }

  // ── no cluster yet ────────────────────────────────────────────────────────
  if (!run) {
    const slots = platform?.slotsAvailable ?? null;
    const signInUrl = `${AUTH_URL}/login?returnUrl=${encodeURIComponent(
      `${HOMELAB_URL}/practice`,
    )}`;

    return (
      <div className={styles.shell}>
        <div className={styles.empty}>
          <p className={styles.kicker}>
            <Radio size={14} /> Real cluster control
          </p>
          <h1>Build a cluster. Then break it.</h1>
          <p className={styles.lede}>
            Provision a disposable Kubernetes workspace on the live homelab — an
            isolated namespace running a checkout API, Postgres, Redis, an Envoy
            gateway and a k6 load generator. Operate it freely, or run a drill
            on it and work a real incident.
          </p>
          <ul className={styles.included}>
            <li>
              <Server size={15} /> Isolated namespace, quota and default-deny
              network policy
            </li>
            <li>
              <Activity size={15} /> Every metric measured from the running
              workload
            </li>
            <li>
              <Lock size={15} /> Private to your account — one cluster at a time
            </li>
            <li>
              <Timer size={15} /> Self-destructs after 15 minutes, extendable
              once
            </li>
          </ul>

          {expired && (
            <p className={styles.expiredNote}>
              <Timer size={14} /> Your last cluster reached its time limit and
              was destroyed. Provision another to pick up where you left off.
            </p>
          )}

          {status.signedIn ? (
            <button
              className={styles.primary}
              onClick={provision}
              disabled={!status.enabled || busy !== null || slots === 0}
            >
              {busy === "provision" ? (
                <Loader2 size={16} className={styles.spin} />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              {busy === "provision"
                ? "Provisioning…"
                : !status.enabled
                  ? "Live control offline"
                  : slots === 0
                    ? "All cluster slots busy"
                    : "Provision cluster"}
            </button>
          ) : (
            <a className={styles.primary} href={signInUrl}>
              <Lock size={16} /> Sign in to provision
            </a>
          )}

          {platform && (
            <p className={styles.capacity}>
              {platform.nodesReady}/{platform.nodesTotal} nodes ready ·{" "}
              {platform.slotsAvailable}/{platform.maxConcurrentRuns} cluster
              slots free
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    );
  }

  // ── live cluster ──────────────────────────────────────────────────────────
  const t = run.telemetry;
  const drill = run.drillId ? drills.find((d) => d.id === run.drillId) : null;
  const provisioning = run.status === "provisioning";
  const flowing = run.loadEnabled && t.requestsPerSec > 0;
  // A selection is either a service ("redis") or one of its pods ("checkout:hl4k9").
  const [selectedSvc, selectedPodName] = (selected ?? "").split(":") as [
    ServiceId | "",
    string | undefined,
  ];
  const selectedNode = selectedSvc ? SERVICES[selectedSvc] : undefined;
  const selectedComp = selectedSvc ? byName(selectedSvc) : undefined;
  const selectedPod = selectedPodName
    ? selectedComp?.pods.find((p) => p.name === selectedPodName)
    : undefined;
  const totalCpu = components.reduce((a, c) => a + c.cpuMillicores, 0);
  const totalMem = components.reduce((a, c) => a + c.memoryMiB, 0);
  // Counted down locally against the run's creation time, so it ticks every second rather than
  // stepping whenever a poll happens to land.
  // Newest first, then filtered — the counts stay on the full set so a chip always shows its total.
  const ordered = [...events].reverse();
  const counts = countByLevel(events);
  const shown = ordered.filter((e) => matches(e, { levels, phases, query }));
  const createdMs = run.createdAt ? Date.parse(run.createdAt) : now;
  const remainingMs = Math.max(0, run.ttlMs - (now - createdMs));
  // The last minute is the only point at which extending is offered: early enough to act on, late
  // enough that it is a real decision rather than a reflex. Dismissing it is allowed; the cluster
  // still ends on time. Once the extension is spent the prompt does not come back, so a cluster's
  // lifetime is capped at two windows and expiry is guaranteed.
  const expiring = remainingMs <= 60_000 && remainingMs > 0;
  const offerRenewal = expiring && run.renewable && !renewalDismissed;

  return (
    <div className={styles.shell}>
      {run.drillSolved && <Celebration />}

      {offerRenewal && (
        <div className={styles.modalScrim} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <span className={styles.modalIcon}>
              <Timer size={18} />
            </span>
            <h3>This cluster closes in {clock(remainingMs)}</h3>
            <p>
              Everything running on it — the workload, the drill you are in, the
              activity so far — goes with it. You can add another 15 minutes,
              once. After that it closes for good.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.primary}
                onClick={renew}
                disabled={busy !== null}
              >
                {busy === "renew" ? (
                  <Loader2 size={13} className={styles.spin} />
                ) : (
                  <Timer size={13} />
                )}
                Add 15 minutes
              </button>
              <button
                className={styles.ghost}
                onClick={() => setRenewalDismissed(true)}
                disabled={busy !== null}
              >
                Let it close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.canvas} ref={canvasRef}>
          {/* the canvas carries its own chrome — no second navbar */}
          <div className={styles.hudTopLeft}>
            <span
              className={`${styles.dot} ${provisioning ? styles.dotWarn : styles.dotOk}`}
            />
            <b>Practice cluster</b>
            <code>{run.namespace ?? run.runId}</code>
            {drill && <span className={styles.drillTag}>{run.drillTitle}</span>}
          </div>

          <div className={styles.hudTopRight}>
            <span
              className={`${styles.hudCard} ${remainingMs < 60_000 ? styles.warnText : ""}`}
              title="Time until this cluster is automatically destroyed"
            >
              <Timer size={13} /> {clock(remainingMs)}
              {!run.renewable && <em className={styles.extended}>extended</em>}
            </span>
            <button
              className={`${styles.hudCard} ${styles.danger}`}
              onClick={teardown}
              disabled={busy !== null}
            >
              {busy === "teardown" ? (
                <Loader2 size={13} className={styles.spin} />
              ) : (
                <Trash2 size={13} />
              )}
              Tear down
            </button>
          </div>

          <svg className={styles.edges} aria-hidden="true">
            {paths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                className={`${styles.edge} ${flowing ? styles.edgeLive : ""}`}
              />
            ))}
          </svg>

          <div className={styles.graph}>
            {COLUMNS.map((column, ci) => (
              <div key={ci} className={styles.column}>
                {column.map((svc) => {
                  const meta = SERVICES[svc];
                  const c = byName(svc);
                  const Icon = meta.icon;
                  const limit = c?.cpuLimitMillicoresPerPod ?? 0;
                  const pods = c?.pods ?? [];
                  const active = selected === svc;
                  // Replicas asked for but not yet reported by Kubernetes.
                  const ghosts = Math.max(0, intendedPods(svc) - pods.length);

                  // Nothing scheduled and nothing asked for: a single placeholder so the shape of
                  // the graph stays readable.
                  if (pods.length === 0 && ghosts === 0) {
                    return (
                      <button
                        key={svc}
                        ref={(el) => {
                          cardRefs.current[`${svc}:placeholder`] = el;
                        }}
                        className={`${styles.card} ${styles.cardOff} ${active ? styles.cardActive : ""}`}
                        onClick={() => setSelected(active ? null : svc)}
                      >
                        <span className={styles.cardHead}>
                          <span className={styles.cardIcon}>
                            <Icon size={14} />
                          </span>
                          <span className={styles.cardTitle}>
                            <b>{meta.label}</b>
                            <small>{meta.role}</small>
                          </span>
                        </span>
                        <span className={styles.cardFoot}>not provisioned</span>
                      </button>
                    );
                  }

                  return [
                    ...pods.map((p) => {
                      const pct =
                        limit > 0
                          ? Math.min(100, (p.cpuMillicores / limit) * 100)
                          : 0;
                      return (
                        <button
                          key={`${svc}:${p.name}`}
                          ref={(el) => {
                            cardRefs.current[`${svc}:${p.name}`] = el;
                          }}
                          className={`${styles.card} ${!p.ready ? styles.cardStarting : ""} ${
                            selected === `${svc}:${p.name}`
                              ? styles.cardActive
                              : ""
                          } ${pct > 85 ? styles.cardHot : ""}`}
                          onClick={() =>
                            setSelected(
                              selected === `${svc}:${p.name}`
                                ? null
                                : `${svc}:${p.name}`,
                            )
                          }
                          title={`${svc}-${p.name} · ${p.phase}`}
                        >
                          <span className={styles.cardHead}>
                            <span className={styles.cardIcon}>
                              <Icon size={14} />
                            </span>
                            <span className={styles.cardTitle}>
                              <b>{meta.label}</b>
                              <small>
                                {pods.length > 1 ? `…${p.name}` : meta.role}
                              </small>
                            </span>
                            {!p.ready ? (
                              <Loader2 size={12} className={styles.spin} />
                            ) : (
                              <span className={styles.readyDot} />
                            )}
                          </span>

                          {/* this pod's CPU against its own limit */}
                          <span className={styles.cardBar}>
                            <i style={{ width: `${Math.max(3, pct)}%` }} />
                          </span>

                          <span className={styles.cardFoot}>
                            {p.ready ? (
                              <>
                                <span>
                                  <Cpu size={10} /> {p.cpuMillicores}m
                                </span>
                                <span>
                                  <MemoryStick size={10} /> {p.memoryMiB}Mi
                                </span>
                                {p.restarts > 0 && (
                                  <span className={styles.warnText}>
                                    ×{p.restarts}
                                  </span>
                                )}
                              </>
                            ) : (
                              // Say what it is doing, not just that it is not done. "Scheduling",
                              // "ContainerCreating" and "ImagePullBackOff" mean very different things
                              // to whoever is watching the scale-up.
                              <span className={styles.phaseText}>
                                {p.detail || p.phase}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    }),

                    // Asked for, not yet reported by the cluster. Drawn in place so the edges fan
                    // out to their final positions the moment the slider moves.
                    ...Array.from({ length: ghosts }, (_, i) => {
                      const blocked = blockedReason(svc);
                      return (
                        <div
                          key={`${svc}:ghost${i}`}
                          ref={(el) => {
                            cardRefs.current[`${svc}:ghost${i}`] = el;
                          }}
                          className={`${styles.card} ${styles.cardGhost} ${
                            blocked ? styles.cardBlocked : ""
                          }`}
                          aria-hidden="true"
                        >
                          <span className={styles.cardHead}>
                            <span className={styles.cardIcon}>
                              <Icon size={14} />
                            </span>
                            <span className={styles.cardTitle}>
                              <b>{meta.label}</b>
                              <small>{blocked ? "refused" : "pending"}</small>
                            </span>
                            {blocked ? (
                              <AlertTriangle size={12} />
                            ) : (
                              <Loader2 size={12} className={styles.spin} />
                            )}
                          </span>
                          <span className={styles.cardBar}>
                            {!blocked && <i className={styles.barPulse} />}
                          </span>
                          <span className={styles.cardFoot}>
                            <span className={styles.phaseText}>
                              {blocked ?? "requesting…"}
                            </span>
                          </span>
                        </div>
                      );
                    }),
                  ];
                })}
              </div>
            ))}
          </div>

          {(converging || busy) && (
            <div className={styles.hudTopCenter}>
              <span className={styles.convergeChip}>
                <Loader2 size={12} className={styles.spin} />
                {converging ? (
                  <>
                    {converging.want > converging.have ? "Scaling" : "Draining"}{" "}
                    <b>{SERVICES[converging.svc].label}</b> to {converging.want}
                    <em>
                      {converging.have} of {converging.want} ready
                    </em>
                  </>
                ) : (
                  <>Applying…</>
                )}
              </span>
            </div>
          )}

          <div className={styles.hudBottomLeft}>
            <span className={flowing ? styles.liveChip : styles.idleChip}>
              <i /> {flowing ? "traffic flowing" : "traffic stopped"}
            </span>
            <span>
              {components.reduce((a, c) => a + c.pods.length, 0)} pods ·{" "}
              {components.length} services
            </span>
            {trace && trace.spans.length > 0 && (
              <span>
                trace {trace.durationMs}ms · {trace.release}
              </span>
            )}
          </div>

          <div className={styles.hudBottomRight}>
            <div className={styles.stat}>
              <span>Throughput</span>
              <b>{t.requestsPerSec}/s</b>
            </div>
            <div
              className={`${styles.stat} ${t.p95LatencyMs > t.latencyTargetMs ? styles.statBad : ""}`}
            >
              <span>p95</span>
              <b>{t.p95LatencyMs}ms</b>
            </div>
            <div
              className={`${styles.stat} ${t.errorRatePct > 1 ? styles.statBad : ""}`}
            >
              <span>Errors</span>
              <b>{t.errorRatePct.toFixed(2)}%</b>
            </div>
            <div className={styles.stat}>
              <span>CPU</span>
              <b>{totalCpu}m</b>
            </div>
            <div className={styles.stat}>
              <span>Memory</span>
              <b>{totalMem}Mi</b>
            </div>
            <div className={styles.stat}>
              <span>SLO</span>
              <b>{t.score}</b>
            </div>
          </div>

          {error && (
            <p className={styles.errorFloat} role="alert">
              <AlertTriangle size={13} /> {error}
              <button onClick={() => setError(null)} aria-label="Dismiss">
                <X size={12} />
              </button>
            </p>
          )}
        </div>

        {/* ── inspector ── */}
        <aside className={styles.inspector}>
          {selectedNode ? (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <b>
                  {selectedNode.label}
                  {selectedPod && (
                    <span className={styles.podTag}>…{selectedPod.name}</span>
                  )}
                </b>
                <button
                  className={styles.iconBtn}
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  <X size={14} />
                </button>
              </div>
              <p className={styles.panelSub}>
                {selectedPod
                  ? `one replica · ${selectedNode.role}`
                  : selectedNode.role}
              </p>

              {selectedPod && selectedComp ? (
                <>
                  <div className={styles.kv}>
                    <span>Status</span>
                    <b
                      className={
                        selectedPod.ready ? styles.okText : styles.warnText
                      }
                    >
                      {selectedPod.ready ? selectedPod.phase : "Starting"}
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>CPU</span>
                    <b>
                      {selectedPod.cpuMillicores}m /{" "}
                      {selectedComp.cpuLimitMillicoresPerPod}m
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>Saturation</span>
                    <b>
                      {selectedComp.cpuLimitMillicoresPerPod
                        ? Math.round(
                            (selectedPod.cpuMillicores /
                              selectedComp.cpuLimitMillicoresPerPod) *
                              100,
                          )
                        : 0}
                      %
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>Memory</span>
                    <b>{selectedPod.memoryMiB} MiB</b>
                  </div>
                  <div className={styles.kv}>
                    <span>Restarts</span>
                    <b className={selectedPod.restarts ? styles.warnText : ""}>
                      {selectedPod.restarts}
                    </b>
                  </div>

                  <p className={styles.panelLabel}>This replica</p>
                  <Spark
                    label="CPU"
                    unit="m"
                    series={(
                      history[`${selectedSvc}:${selectedPod.name}`] ?? []
                    ).map((h) => h.cpu)}
                  />
                  <Spark
                    label="Memory"
                    unit="Mi"
                    series={(
                      history[`${selectedSvc}:${selectedPod.name}`] ?? []
                    ).map((h) => h.mem)}
                  />

                  {selectedComp.pods.length > 1 && (
                    <>
                      <p className={styles.panelLabel}>
                        Other replicas ({selectedComp.pods.length})
                      </p>
                      <div className={styles.siblings}>
                        {selectedComp.pods.map((p) => (
                          <button
                            key={p.name}
                            className={
                              p.name === selectedPod.name
                                ? styles.siblingOn
                                : ""
                            }
                            onClick={() =>
                              setSelected(`${selectedSvc}:${p.name}`)
                            }
                          >
                            <span>…{p.name}</span>
                            <span>{p.cpuMillicores}m</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <button
                    className={styles.ghost}
                    onClick={() => setSelected(selectedSvc)}
                  >
                    <Layers size={12} /> View the whole service
                  </button>

                  {selectedSvc === "checkout" && trace?.spans.length ? (
                    <>
                      <p className={styles.panelLabel}>Latest trace</p>
                      <div className={styles.trace}>
                        {trace.spans.map((sp) => (
                          <div key={sp.spanId} className={styles.span}>
                            <span>{sp.name}</span>
                            <div className={styles.spanBar}>
                              <i
                                className={
                                  sp.status === "error" ? styles.spanErr : ""
                                }
                                style={{
                                  width: `${Math.max(2, Math.min(100, (sp.durationMs / Math.max(1, trace.durationMs)) * 100))}%`,
                                }}
                              />
                            </div>
                            <b>{Math.round(sp.durationMs)}ms</b>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              ) : selectedComp && selectedComp.desired > 0 ? (
                <>
                  <div className={styles.kv}>
                    <span>Replicas</span>
                    <b>
                      {selectedComp.ready}/{selectedComp.desired}
                    </b>
                  </div>
                  <div className={styles.kv}>
                    <span>CPU</span>
                    <b>{selectedComp.cpuMillicores}m</b>
                  </div>
                  <div className={styles.kv}>
                    <span>Memory</span>
                    <b>{selectedComp.memoryMiB} MiB</b>
                  </div>

                  <p className={styles.panelLabel}>Service total</p>
                  <Spark
                    label="CPU"
                    unit="m"
                    series={(history[selectedComp.name] ?? []).map(
                      (h) => h.cpu,
                    )}
                  />

                  <p className={styles.panelLabel}>Replicas — pick one</p>
                  <div className={styles.siblings}>
                    {selectedComp.pods.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => setSelected(`${selectedSvc}:${p.name}`)}
                      >
                        <span>…{p.name}</span>
                        <span>{p.cpuMillicores}m</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className={styles.blank}>
                  This service is not provisioned right now.
                </p>
              )}
            </div>
          ) : (
            <div className={styles.panel}>
              <div className={styles.tabs}>
                {TABS.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    className={tab === id ? styles.tabOn : ""}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={13} /> {label}
                  </button>
                ))}
              </div>

              {tab === "drills" &&
                (!drill ? (
                  <>
                    <p className={styles.hint}>
                      A drill sets an objective and a clock on this cluster and
                      unlocks its operator decisions. Nothing is reprovisioned —
                      the workload stays up.
                    </p>
                    <div className={styles.drills}>
                      {drills.map((d, i) => (
                        <button
                          key={d.id}
                          className={styles.drillItem}
                          onClick={() =>
                            act(`drill-${d.id}`, () =>
                              startDrill(run.runId, d.id),
                            )
                          }
                          disabled={busy !== null || provisioning}
                        >
                          <span className={styles.drillNo}>
                            {busy === `drill-${d.id}` ? (
                              <Loader2 size={12} className={styles.spin} />
                            ) : (
                              String(i + 1).padStart(2, "0")
                            )}
                          </span>
                          <span>
                            <b>{d.title}</b>
                            <small>{d.summary}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                    {provisioning && (
                      <p className={styles.hint}>
                        Drills unlock once the workload is serving traffic.
                      </p>
                    )}
                  </>
                ) : run.drillSolved ? (
                  <div className={styles.solved}>
                    <span className={styles.solvedIcon}>
                      <PartyPopper size={22} />
                    </span>
                    <b>Drill complete</b>
                    <p className={styles.solvedName}>
                      {run.drillTitle || drill.title}
                    </p>
                    <div className={styles.scoreRow}>
                      <div>
                        <span>Correct</span>
                        <b>
                          {run.drillCorrectChosen}/{run.drillCorrectTotal}
                        </b>
                      </div>
                      <div>
                        <span>Missteps</span>
                        <b
                          className={
                            run.drillWrongChosen ? styles.warnText : ""
                          }
                        >
                          {run.drillWrongChosen}
                        </b>
                      </div>
                      <div>
                        <span>Time</span>
                        <b>{clock(run.elapsedMs)}</b>
                      </div>
                    </div>
                    <p className={styles.solvedSub}>
                      The cluster is still yours — run another drill on it, or
                      keep experimenting with the controls.
                    </p>
                    <button
                      className={styles.primarySm}
                      onClick={() => act("end", () => endDrill(run.runId))}
                      disabled={busy !== null}
                    >
                      {busy === "end" ? (
                        <Loader2 size={14} className={styles.spin} />
                      ) : (
                        <Gauge size={14} />
                      )}
                      Choose another drill
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.objective}>
                      <b>{run.drillTitle || drill.title}</b>
                      <p>{run.drillObjective || drill.summary}</p>
                      <span>
                        {run.drillCorrectChosen} of {run.drillCorrectTotal} key
                        actions found · {clock(run.elapsedMs)} elapsed
                      </span>
                    </div>
                    <div
                      className={styles.progress}
                      title={`${run.drillCorrectChosen} of ${run.drillCorrectTotal} correct actions`}
                    >
                      <i
                        style={{
                          width: `${Math.min(100, (run.drillCorrectChosen / Math.max(1, run.drillCorrectTotal)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className={styles.qHint}>
                      Pick the actions you think resolve this. Every option is
                      really applied to your cluster — watch the measured
                      signals to see whether it worked.
                    </p>
                    <div className={styles.decisions}>
                      {run.drillOptions.map((o) => {
                        const answered = o.chosen;
                        const right = o.isCorrect === true;
                        const pending = busy === `dec-${o.id}`;
                        return (
                          <div key={o.id} className={styles.qWrap}>
                            <button
                              className={`${styles.decision} ${
                                answered
                                  ? right
                                    ? styles.qRight
                                    : styles.qWrong
                                  : ""
                              } ${pending ? styles.pending : ""}`}
                              onClick={() =>
                                act(`dec-${o.id}`, () =>
                                  liveDecision(run.runId, o.id),
                                )
                              }
                              disabled={
                                !o.unlocked || answered || busy !== null
                              }
                            >
                              {pending || !o.unlocked ? (
                                <Loader2 size={14} className={styles.spin} />
                              ) : answered ? (
                                right ? (
                                  <Check size={14} />
                                ) : (
                                  <AlertTriangle size={14} />
                                )
                              ) : (
                                <Gauge size={14} />
                              )}
                              <span>
                                <b>{o.label}</b>
                                <small>
                                  {pending
                                    ? "Applying to the cluster…"
                                    : !o.unlocked
                                      ? `Collecting a baseline from live traffic — unlocks in ${o.unlocksInSeconds}s`
                                      : o.description}
                                </small>
                              </span>
                            </button>
                            {answered && o.explanation && (
                              <p
                                className={`${styles.qWhy} ${right ? styles.qWhyOk : styles.qWhyBad}`}
                              >
                                {o.explanation}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      className={styles.ghost}
                      onClick={() => act("end", () => endDrill(run.runId))}
                      disabled={busy !== null}
                    >
                      {busy === "end" ? (
                        <Loader2 size={12} className={styles.spin} />
                      ) : (
                        <Square size={12} />
                      )}
                      End drill, keep cluster
                    </button>
                  </>
                ))}

              {tab === "controls" && (
                <div className={styles.controls}>
                  {SLIDERS.map((sl) => (
                    <RangeSlider
                      key={sl.label}
                      label={sl.label}
                      hint={sl.hint}
                      min={sl.min}
                      max={sl.max}
                      ticks
                      value={sl.value(run)}
                      format={sl.unit}
                      pending={busy?.startsWith(sl.prefix) ?? false}
                      onCommit={(n) =>
                        act(
                          `${sl.prefix}${n}`,
                          () => practiceAction(run.runId, `${sl.prefix}${n}`),
                          (r) => sl.apply(r, n),
                        )
                      }
                    />
                  ))}

                  {CONTROLS.map((g) => {
                    const activeId = g.active(run);
                    return (
                      <div key={g.label} className={styles.control}>
                        <label>{g.label}</label>
                        <div className={styles.segments}>
                          {g.options.map((o) => (
                            <button
                              key={o.id}
                              className={`${activeId === o.id ? styles.segOn : ""} ${busy === o.id ? styles.pending : ""}`}
                              onClick={() =>
                                act(
                                  o.id,
                                  () => practiceAction(run.runId, o.id),
                                  o.apply,
                                )
                              }
                              disabled={busy !== null || activeId === o.id}
                            >
                              {busy === o.id ? (
                                <Loader2 size={12} className={styles.spin} />
                              ) : (
                                o.label
                              )}
                            </button>
                          ))}
                        </div>
                        <small>{g.hint}</small>
                      </div>
                    );
                  })}
                  <p className={styles.note}>
                    <Lock size={12} /> Private to your account.{" "}
                    <CircleSlash size={12} /> Egress denied by default.
                  </p>
                </div>
              )}

              {tab === "activity" && (
                <>
                  <div className={styles.filterBar}>
                    <input
                      className={styles.search}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search reason, message or object…"
                      aria-label="Search activity"
                    />
                    {(levels.size > 0 || phases.size > 0 || query) && (
                      <button
                        className={styles.clearBtn}
                        onClick={() => {
                          setLevels(new Set());
                          setPhases(new Set());
                          setQuery("");
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className={styles.chips}>
                    {LEVELS.map((l) => {
                      const on = levels.has(l.id);
                      const n = counts[l.id];
                      return (
                        <button
                          key={l.id}
                          className={`${styles.chip} ${styles[`lvl-${l.id}`]} ${on ? styles.chipOn : ""}`}
                          onClick={() => setLevels(toggle(levels, l.id))}
                          aria-pressed={on}
                        >
                          <i /> {l.label}
                          <em>{n}</em>
                        </button>
                      );
                    })}
                  </div>

                  <div className={styles.chips}>
                    {PHASES.filter((ph) =>
                      events.some((e) => phaseOf(e) === ph.id),
                    ).map((ph) => {
                      const on = phases.has(ph.id);
                      return (
                        <button
                          key={ph.id}
                          className={`${styles.chip} ${styles.chipPhase} ${on ? styles.chipOn : ""}`}
                          onClick={() => setPhases(toggle(phases, ph.id))}
                          aria-pressed={on}
                        >
                          {ph.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className={styles.events}>
                    {shown.length === 0 ? (
                      <p className={styles.blank}>
                        {events.length === 0
                          ? provisioning
                            ? "Scheduling workloads…"
                            : "No activity yet."
                          : "Nothing matches these filters."}
                      </p>
                    ) : (
                      shown.map((e) => {
                        const lvl = levelOf(e);
                        return (
                          <article
                            key={e.id}
                            className={`${styles.event} ${styles[`ev-${lvl}`]}`}
                          >
                            <i />
                            <div>
                              <p>
                                <b>{e.reason}</b>
                                <span className={styles.evPhase}>
                                  {phaseOf(e)}
                                </span>
                                <span>
                                  {e.objectKind} · {ago(e.at)}
                                </span>
                              </p>
                              <small>{e.message}</small>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
