"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceRankedLaunch,
  cancelRankedLaunch,
  fetchRankedLaunch,
  LiveError,
  type RankedLaunchView,
} from "@/shared/api/live-client";
import { rankedLaunchPollDelay } from "./launch-poll";

export function useRankedLaunch({
  enabled,
  onActive,
  onCancelled,
}: {
  enabled: boolean;
  onActive: (runId: string) => Promise<void>;
  onCancelled: () => void;
}) {
  const [launch, setLaunch] = useState<RankedLaunchView | null>(null);
  const [checking, setChecking] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanceFailures, setAdvanceFailures] = useState(0);
  const inFlight = useRef(false);
  const requestEpoch = useRef(0);

  const accept = useCallback(
    async (next: RankedLaunchView) => {
      setLaunch(next);
      setError(null);
      setAdvanceFailures(0);
      if (next.active) await onActive(next.runId);
    },
    [onActive],
  );

  const advance = useCallback(
    async (retry: boolean, start: boolean) => {
      if (!enabled || inFlight.current) return;
      const epoch = requestEpoch.current;
      inFlight.current = true;
      setAdvancing(true);
      try {
        const next = await advanceRankedLaunch(retry, start);
        if (epoch === requestEpoch.current) await accept(next);
      } catch (cause) {
        if (epoch !== requestEpoch.current) return;
        setAdvanceFailures((current) => Math.min(10, current + 1));
        setError(
          cause instanceof Error
            ? cause.message
            : "The ranked launch could not advance.",
        );
      } finally {
        if (epoch === requestEpoch.current) {
          inFlight.current = false;
          setAdvancing(false);
        }
      }
    },
    [accept, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchRankedLaunch()
      .then(async (existing) => {
        if (!alive) return;
        await accept(existing);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        if (!(cause instanceof LiveError && cause.status === 404)) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The ranked launch could not be read.",
          );
        }
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [accept, enabled]);

  useEffect(() => {
    if (!enabled || !launch || launch.terminal || advancing) return;
    const timer = window.setTimeout(
      () => void advance(false, false),
      rankedLaunchPollDelay(advanceFailures),
    );
    return () => window.clearTimeout(timer);
  }, [advance, advanceFailures, advancing, enabled, launch]);

  const cancel = useCallback(async () => {
    if (!enabled || cancelling || !launch || launch.active) return;
    requestEpoch.current += 1;
    inFlight.current = false;
    setAdvancing(false);
    setCancelling(true);
    setError(null);
    try {
      await cancelRankedLaunch();
      setLaunch(null);
      onCancelled();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The ranked launch could not be cancelled.",
      );
    } finally {
      setCancelling(false);
    }
  }, [cancelling, enabled, launch, onCancelled]);

  return {
    launch,
    checking,
    advancing,
    cancelling,
    error,
    start: () => advance(false, true),
    retry: () => advance(true, true),
    cancel,
  };
}
