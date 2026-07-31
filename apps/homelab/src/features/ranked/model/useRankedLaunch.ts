"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelRankedLaunch,
  fetchRankedLaunch,
  LiveError,
  streamRankedLaunch,
  type RankedLaunchView,
} from "@/shared/api/live-client";
import { rankedLaunchReconnectDelay } from "./launch-poll";

/**
 * The ranked launch, as one connection rather than a timer.
 *
 * The launch itself is a server-side state machine; this hook opens a stream, renders what comes
 * back, and decides when to reopen one. It deliberately does not decide when the launch advances —
 * that used to live here, as a 1.5s POST loop, and it made the browser responsible for driving a
 * process it cannot observe. A dropped stream now costs a viewer and nothing else: the launch keeps
 * its state on the cluster, so reconnecting resumes rather than restarts.
 */
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

  // Bumped whenever a stream is superseded — by a cancel, by a retry, or by the hook unmounting.
  // A late callback from an abandoned stream checks it and stays silent rather than writing state
  // for a launch the page has already moved on from.
  const epoch = useRef(0);
  const connection = useRef<AbortController | null>(null);
  const failures = useRef(0);
  const reconnect = useRef<number | null>(null);
  // Held in a ref so a caller re-creating its callbacks each render cannot tear down a live stream.
  const activated = useRef(onActive);
  const handedOff = useRef<string | null>(null);
  // Lets a reconnect timer reach the current `drive` without `drive` depending on itself, which
  // would make every render a new identity and restart the stream.
  const driver = useRef<(() => void) | null>(null);

  useEffect(() => {
    activated.current = onActive;
  }, [onActive]);

  const closeStream = useCallback(() => {
    epoch.current += 1;
    connection.current?.abort();
    connection.current = null;
    if (reconnect.current !== null) {
      window.clearTimeout(reconnect.current);
      reconnect.current = null;
    }
  }, []);

  /**
   * Open a stream and keep it open until the launch is terminal.
   *
   * `start` and `retry` belong to the first advance only, so a reconnect never replays them: retry
   * resets a failed launch, and replaying that against a launch already progressing would throw
   * away the cluster it is standing up.
   */
  const drive = useCallback(
    (options: { retry?: boolean; start?: boolean } = {}) => {
      if (!enabled) return;
      closeStream();
      const mine = epoch.current;
      const controller = new AbortController();
      connection.current = controller;
      setAdvancing(true);
      // Only an explicit start or retry clears the message. A reconnect clearing it would make a
      // launch that is failing to stream flash its own error away every few seconds, and take the
      // retry button with it.
      if (options.start || options.retry) setError(null);

      let latest: RankedLaunchView | null = null;

      const settle = (nextFailures: number) => {
        if (mine !== epoch.current) return;
        failures.current = nextFailures;
        connection.current = null;
        setAdvancing(false);

        // A stream that ended without the launch reaching a terminal phase means the connection
        // gave out, not the launch. It is still running on the cluster, so pick it back up.
        if (latest !== null && latest.terminal) return;
        reconnect.current = window.setTimeout(
          () => driver.current?.(),
          rankedLaunchReconnectDelay(nextFailures),
        );
      };

      void streamRankedLaunch({
        retry: options.retry,
        start: options.start,
        signal: controller.signal,
        onLaunch: (view) => {
          if (mine !== epoch.current) return;
          latest = view;
          failures.current = 0;
          setLaunch(view);
          setError(null);
        },
        // Elapsed time arrives on its own frame so the stream does not have to re-send the whole
        // launch — checks included — once a second just to move a clock.
        onElapsed: (seconds) => {
          if (mine !== epoch.current) return;
          setLaunch((current) =>
            current ? { ...current, launchElapsedSeconds: seconds } : current,
          );
        },
      })
        .then(() => settle(0))
        .catch((cause: unknown) => {
          if (mine !== epoch.current) return;
          if (controller.signal.aborted) return;

          // The launch is genuinely gone — cancelled elsewhere, or reaped. Reconnecting would only
          // ask again and get the same answer.
          if (cause instanceof LiveError && cause.status === 404) {
            setLaunch(null);
            connection.current = null;
            setAdvancing(false);
            return;
          }

          setError(
            cause instanceof Error
              ? cause.message
              : "The ranked launch could not advance.",
          );
          settle(Math.min(10, failures.current + 1));
        });
    },
    [closeStream, enabled],
  );

  useEffect(() => {
    // A reconnect always resumes: never a start, never a retry.
    driver.current = () => drive();
  }, [drive]);

  // Resume on arrival. One cheap read answers "does this operator have a launch", which decides
  // whether the page shows the launch screen at all; only then is it worth holding a connection open.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchRankedLaunch()
      .then((existing) => {
        if (!alive) return;
        setLaunch(existing);
        if (!existing.terminal) drive();
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
      // Leaving the ranked surface, signing out, or unmounting. `drive` only changes identity when
      // `enabled` does, so this cleanup is never the thing that interrupts a healthy launch.
      closeStream();
    };
  }, [closeStream, drive, enabled]);

  // The hand-off to the live match, once per run. Driven off the rendered state rather than from
  // inside the stream callback, so it happens exactly once however the active view arrived — from
  // the resume read, from a frame, or from a reconnect that found the match already live.
  useEffect(() => {
    if (!launch?.active || handedOff.current === launch.runId) return;
    handedOff.current = launch.runId;
    void activated.current(launch.runId);
  }, [launch]);

  const cancel = useCallback(async () => {
    if (!enabled || cancelling || !launch || launch.active) return;
    closeStream();
    setAdvancing(false);
    setCancelling(true);
    setError(null);
    try {
      await cancelRankedLaunch();
      setLaunch(null);
      handedOff.current = null;
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
  }, [cancelling, closeStream, enabled, launch, onCancelled]);

  return {
    launch,
    checking,
    advancing,
    cancelling,
    error,
    start: () => drive({ start: true }),
    retry: () => drive({ retry: true, start: true }),
    cancel,
  };
}
