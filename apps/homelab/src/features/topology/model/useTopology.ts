"use client";

import { useEffect, useState } from "react";
import { fetchTopology, type HomelabTopology } from "@/shared/api/live-client";

const POLL_MS = 15_000;

export interface TopologyState {
  topology: HomelabTopology | null;
  error: string | null;
}

/**
 * Polls the sanitized inventory.
 *
 * Stops while the tab is hidden and refreshes the moment it comes back. Upstream every one of these
 * is a real cluster read, so a background tab left open overnight quietly costing four API-server
 * sweeps a minute is not a rounding error — it is the largest share of the load this page creates.
 */
export function useTopology(): TopologyState {
  const [topology, setTopology] = useState<HomelabTopology | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const next = await fetchTopology();
        if (cancelled) return;
        setTopology(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Topology unavailable");
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(async () => {
        await load();
        schedule();
      }, POLL_MS);
    };

    const onVisibility = () => {
      if (document.hidden) window.clearTimeout(timer);
      else void load().then(schedule);
    };

    void load().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { topology, error };
}
