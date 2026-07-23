"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { LiveState } from "@/entities/scenario/types";
import { getMe, type SessionUser } from "@iw/core";
import { getPrefs, type FeedDensity } from "@/shared/lib/prefs";
import { ROLE_LABEL } from "@/entities/scenario/recording";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import styles from "./LiveView.module.css";

// The /live page body. Polls /api/live so the VM screen and activity feed move on their own, and
// lets a visitor queue a scenario. The VM screen is intentionally NON-INTERACTIVE — a read-only view
// of what the lab is doing. Today it renders the simulated feed; the same component renders a real
// Guacamole read-only stream once `streamMode` is "guacamole".

const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60),
    s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function LiveView({
  initial,
  queueOptions,
}: {
  initial: LiveState;
  queueOptions: Array<{ id: string; title: string }>;
}) {
  const [state, setState] = useState<LiveState>(initial);
  const [pick, setPick] = useState(queueOptions[0]?.id ?? "");
  const [queuing, setQueuing] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [density, setDensity] = useState<FeedDensity>("comfortable");
  const screenRef = useRef<HTMLDivElement>(null);

  // shared-cookie SSO: if they're signed in anywhere on the network, attribute their queue requests
  useEffect(() => {
    let alive = true;
    getMe().then((u) => {
      if (!alive) return;
      setUser(u);
      setDensity(getPrefs().feedDensity); // cosmetic pref — feed chrome only
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } catch {
      /* transient; keep last state */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [refresh]);

  // keep the VM screen scrolled to the newest line
  useEffect(() => {
    const el = screenRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.live.screen.lines]);

  const queue = async () => {
    if (!pick) return;
    setQueuing(true);
    try {
      const res = await fetch("/api/live/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseStudyId: pick,
          requestedBy: user?.displayName,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.state) setState(data.state);
        const title = queueOptions.find((o) => o.id === pick)?.title ?? pick;
        toast.success("Queued", { description: `${title} runs next.` });
      } else {
        toast.error(data.error ?? "Could not queue.");
      }
    } catch {
      toast.error("Network error — try again.");
    } finally {
      setQueuing(false);
    }
  };

  const { live, queue: q, streamMode } = state;
  const activeRole = live.screen.role;
  const pct = live.durationSec
    ? Math.min(100, (live.elapsedSec / live.durationSec) * 100)
    : 0;

  return (
    <div
      className={styles.wrap}
      data-lab-reveal
      data-lab-delay="80"
      style={{
        ["--role" as string]: `var(--${activeRole})`,
        ["--active" as string]: `var(--${activeRole})`,
      }}
    >
      {/* Now running */}
      <div className={styles.nowCard}>
        <div className={styles.nowTop}>
          <div className={styles.nowTitleWrap}>
            <span className={styles.nowLabel}>
              <span className={styles.blip} /> Running now
            </span>
            <div className={styles.nowTitle}>{live.title}</div>
            <div className={styles.nowSub}>{live.summary}</div>
          </div>
          <div className={styles.nowMeta}>
            <Badge variant={streamMode === "simulated" ? "sim" : "live"}>
              {streamMode === "simulated"
                ? "Simulated feed"
                : "Live · Guacamole"}
            </Badge>
            <span className={styles.counter}>
              step {String(live.currentStep + 1).padStart(2, "0")} /{" "}
              {String(live.totalSteps).padStart(2, "0")} ·{" "}
              {fmtClock(live.elapsedSec)} / {fmtClock(live.durationSec)}
            </span>
          </div>
        </div>
        <div className={styles.roles}>
          {live.actors.map((a) => (
            <span
              key={a.id}
              className="role-tag"
              style={{ ["--role" as string]: `var(--${a.role})` }}
            >
              {ROLE_LABEL[a.role]}
            </span>
          ))}
        </div>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Scenario progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={styles.grid}>
        {/* The live VM screen (non-interactive) */}
        <div
          className={styles.screen}
          style={{ ["--role" as string]: `var(--${activeRole})` }}
        >
          <div className={styles.screenBar}>
            <div className={styles.lights}>
              <i />
              <i />
              <i />
            </div>
            <div className={styles.screenTitle}>{live.screen.title}</div>
            <span className={styles.liveDot}>
              <i /> Live
            </span>
            <span className={styles.noInput}>view only</span>
          </div>
          <div className={styles.screenBody} ref={screenRef} aria-live="off">
            {live.screen.lines.map((l, i) => {
              const kind = l.startsWith("# ")
                ? "say"
                : l.startsWith("$ ")
                  ? "cmd"
                  : "out";
              return (
                <div
                  key={i}
                  className={`${styles.sline} ${kind === "say" ? styles.say : kind === "cmd" ? styles.cmd : ""}`}
                >
                  {l}
                </div>
              );
            })}
            <div>
              <span className={styles.cursor} />
            </div>
          </div>
        </div>

        {/* Side rail: activity + queue */}
        <div className={styles.rail}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span>Activity</span>
              <span>{live.activity.length}</span>
            </div>
            <div
              className={`${styles.feed} ${density === "compact" ? styles.compact : ""}`}
            >
              {live.activity.map((e, i) => (
                <div
                  key={i}
                  className={styles.feedItem}
                  style={{ ["--role" as string]: `var(--${e.role})` }}
                >
                  <div className={styles.feedT}>{fmtClock(e.t)}</div>
                  <div className={`${styles.feedText} ${styles[e.kind]}`}>
                    <span className={styles.who}>{ROLE_LABEL[e.role]}</span>
                    {e.kind === "command" ? `$ ${e.text}` : e.text}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span>Queue a scenario</span>
            </div>
            <div className={styles.queueForm}>
              <Select value={pick} onValueChange={setPick}>
                <SelectTrigger
                  className="flex-1"
                  aria-label="Scenario to queue"
                >
                  <SelectValue placeholder="Pick a scenario" />
                </SelectTrigger>
                <SelectContent>
                  {queueOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={queue} disabled={queuing || !pick}>
                {queuing ? "Queuing…" : "Queue it"}
              </Button>
            </div>
            {q.length === 0 ? (
              <div className={styles.queueEmpty}>
                Nothing queued. Queue a scenario and it runs next.
              </div>
            ) : (
              <div className={styles.queueList}>
                {q.map((item, i) => (
                  <div key={item.id} className={styles.qItem}>
                    <span className={styles.qPos}>{i + 1}</span>
                    <span className={styles.qTitle}>{item.title}</span>
                    <span className={styles.qWho}>{item.requestedBy}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.note}>
            This is a <strong>read-only</strong> view. The screen shows what the
            lab is doing; you can&apos;t control it. The feed is currently{" "}
            <strong>simulated</strong> — a real run streams here over read-only
            Guacamole once the orchestrator is wired in.
          </div>
        </div>
      </div>
    </div>
  );
}
