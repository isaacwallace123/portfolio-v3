"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceRankedLaunch,
  cancelRankedLaunch,
  fetchRankedLaunch,
  LiveError,
  type RankedLaunchView,
} from "@/shared/api/live-client";

const POLL_MS = 1_500;

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
  const inFlight = useRef(false);

  const accept = useCallback(
    async (next: RankedLaunchView) => {
      setLaunch(next);
      setError(null);
      if (next.active) await onActive(next.runId);
    },
    [onActive],
  );

  const advance = useCallback(
    async (retry: boolean) => {
      if (!enabled || inFlight.current) return;
      inFlight.current = true;
      setAdvancing(true);
      try {
        await accept(await advanceRankedLaunch(retry));
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The ranked launch could not advance.",
        );
      } finally {
        inFlight.current = false;
        setAdvancing(false);
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
    const timer = window.setTimeout(() => void advance(false), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [advance, advancing, enabled, launch]);

  const cancel = useCallback(async () => {
    if (!enabled || cancelling || !launch || launch.active) return;
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
    start: () => advance(false),
    retry: () => advance(true),
    cancel,
  };
}
