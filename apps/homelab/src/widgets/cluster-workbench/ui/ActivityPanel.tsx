"use client";

import { useState } from "react";
import type { ClusterEvent } from "@/shared/lib/liveClient";
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
import { ago, toggle } from "../model/format";
import styles from "../workbench.module.css";

/**
 * The cluster's real Kubernetes events as a filterable log. Both filters are additive and
 * multi-select: an empty set means "no restriction on this dimension", so choosing Info and Success
 * shows exactly those two. Counts stay on the full set, so a chip always shows its own total rather
 * than what survives the other filters.
 */
export function ActivityPanel({
  events,
  provisioning,
}: {
  events: ClusterEvent[];
  provisioning: boolean;
}) {
  const [levels, setLevels] = useState<Set<Level>>(new Set());
  const [phases, setPhases] = useState<Set<Phase>>(new Set());
  const [query, setQuery] = useState("");

  const counts = countByLevel(events);
  const shown = [...events]
    .reverse()
    .filter((e) => matches(e, { levels, phases, query }));
  const present = PHASES.filter((ph) =>
    events.some((e) => phaseOf(e) === ph.id),
  );
  const filtered = levels.size > 0 || phases.size > 0 || query.length > 0;

  return (
    <>
      <div className={styles.filterBar}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search reason, message or object…"
          aria-label="Search activity"
        />
        {filtered && (
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
          return (
            <button
              key={l.id}
              className={`${styles.chip} ${styles[`lvl-${l.id}`]} ${on ? styles.chipOn : ""}`}
              onClick={() => setLevels(toggle(levels, l.id))}
              aria-pressed={on}
            >
              <i /> {l.label}
              <em>{counts[l.id]}</em>
            </button>
          );
        })}
      </div>

      <div className={styles.chips}>
        {present.map((ph) => {
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
            {events.length > 0
              ? "Nothing matches these filters."
              : provisioning
                ? "Scheduling workloads…"
                : "No activity yet."}
          </p>
        ) : (
          shown.map((e) => (
            <article
              key={e.id}
              className={`${styles.event} ${styles[`ev-${levelOf(e)}`]}`}
            >
              <i />
              <div>
                <p>
                  <b>{e.reason}</b>
                  <span className={styles.evPhase}>{phaseOf(e)}</span>
                  <span>
                    {e.objectKind} · {ago(e.at)}
                  </span>
                </p>
                <small>{e.message}</small>
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}
