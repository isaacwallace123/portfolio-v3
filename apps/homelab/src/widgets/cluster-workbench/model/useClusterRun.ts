"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLiveRun,
  fetchLiveStatus,
  fetchPlatformStatus,
  fetchSnapshot,
  LiveError,
  renewRun,
  teardownLiveRun,
  type ClusterEvent,
  type LivePlatformStatus,
  type LiveRunView,
  type LiveStatus,
  type LiveTrace,
  type RunComponent,
} from "@/shared/lib/liveClient";

const SANDBOX = "practice-cluster";
const POLL_MS = 1200;
const HISTORY = 40; // ~50s of samples at the poll interval
/** Consecutive failures before the page admits on screen that its numbers are stale. */
const STALE_AFTER = 4;

export type Series = Record<string, { cpu: number; mem: number }[]>;

/**
 * Owns the cluster: fetching it, keeping it current, and every mutation the page can make to it.
 * The component tree below this reads state and calls actions; none of it knows about polling,
 * ownership of an in-flight request, or what a 404 means.
 */
export function useClusterRun() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [platform, setPlatform] = useState<LivePlatformStatus | null>(null);
  const [run, setRun] = useState<LiveRunView | null>(null);
  const [components, setComponents] = useState<RunComponent[]>([]);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [trace, setTrace] = useState<LiveTrace | null>(null);
  const [history, setHistory] = useState<Series>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [stale, setStale] = useState(false);

  // Ticks once a second so the countdown moves smoothly between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const poll = useRef<number | null>(null);
  const failures = useRef(0);
  // Every mutation bumps this. A refresh captures it before fetching and drops its run payload if a
  // mutation happened meanwhile — otherwise an in-flight poll lands after an action and reverts it.
  const mutationSeq = useRef(0);
  // The cluster this page is attached to. A poll started before a teardown would otherwise land
  // afterwards and put the torn-down cluster straight back on screen.
  const attached = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (poll.current !== null) {
      window.clearInterval(poll.current);
      poll.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  // Let go of the current cluster. One place, so teardown, expiry and "the API says it is being
  // deleted" cannot each get it subtly different.
  const release = useCallback(() => {
    attached.current = null;
    failures.current = 0;
    stopPolling();
    setStale(false);
    setRun(null);
    setComponents([]);
    setEvents([]);
    setTrace(null);
    setHistory({});
    setStatus((s) => (s ? { ...s, myRunId: null } : s));
  }, [stopPolling]);

  const refresh = useCallback(
    async (runId: string) => {
      const seq = mutationSeq.current;
      const snap = await fetchSnapshot(runId);

      // The page moved on while this was in flight — drop the whole payload.
      if (attached.current !== runId) return;
      // A cluster being deleted is gone as far as the page is concerned: the API still answers for
      // it until Crossplane finishes collecting the namespace.
      if (snap.run.deleting) return release();
      // Out of time. The reaper deletes the LabRun on the same deadline, so the page lets go here
      // rather than leaving a dead cluster on screen with its timer frozen at zero.
      if (snap.run.remainingTtlMs <= 0) {
        release();
        setExpired(true);
        return;
      }

      // Measured data is always safe to apply; desired state is not if it raced a mutation.
      if (seq === mutationSeq.current) setRun(snap.run);
      setComponents(snap.components);
      setEvents(snap.events);
      setTrace(snap.trace);

      // A trend per service AND per pod, so the inspector can graph whichever one is selected.
      setHistory((prev) => {
        const next = { ...prev };
        const push = (key: string, cpu: number, mem: number) => {
          next[key] = [...(next[key] ?? []), { cpu, mem }].slice(-HISTORY);
        };
        for (const c of snap.components) {
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
      failures.current = 0;
      poll.current = window.setInterval(() => {
        refresh(runId).then(
          () => {
            failures.current = 0;
            setStale(false);
          },
          (e: unknown) => {
            // 404 is the one honest "stop": the cluster no longer exists.
            if (e instanceof LiveError && e.status === 404) {
              release();
              setExpired(true);
              return;
            }
            // Everything else is transient — the workload is still starting, a scrape timed out,
            // the API pod rolled. Keep polling and say so rather than freezing on stale numbers.
            failures.current += 1;
            setStale(failures.current >= STALE_AFTER);
          },
        );
      }, POLL_MS);
    },
    [refresh, stopPolling, release],
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

  /** Run a mutation, optionally reflecting its effect locally first so the UI responds at once. */
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
  }, [act, run]);

  const teardown = useCallback(async () => {
    if (!run) return;
    setBusy("teardown");
    // Detach first: the cluster is given up the moment the request goes out, so nothing already in
    // flight can put it back.
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

  return {
    status,
    platform,
    run,
    components,
    events,
    trace,
    history,
    busy,
    error,
    expired,
    stale,
    now,
    setError,
    act,
    provision,
    renew,
    teardown,
  };
}
