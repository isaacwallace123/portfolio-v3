"use client";

import { ChevronRight, Layers, Loader2, Trophy, Zap } from "lucide-react";
import {
  startDrill,
  type DrillCatalogEntry,
  type LiveRunView,
} from "@/shared/api/live-client";
import { clock, clockOrDash as time } from "@/shared/lib/format";
import styles from "../drill.module.css";

type Act = (key: string, fn: () => Promise<LiveRunView | void>) => void;

function DrillRow({
  drill,
  busy,
  disabled,
  onStart,
}: {
  drill: DrillCatalogEntry;
  busy: string | null;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <button
      className={styles.drillItem}
      onClick={onStart}
      disabled={disabled}
      title={drill.objective}
    >
      <span className={styles.drillIcon}>
        {busy === `drill-${drill.id}` ? (
          <Loader2 size={12} className={styles.spin} />
        ) : drill.stageCount > 1 ? (
          <Layers size={12} />
        ) : (
          <Zap size={12} />
        )}
      </span>
      <span className={styles.drillBody}>
        <b>{drill.title}</b>
        <small>{drill.summary}</small>
        <span className={styles.drillMeta}>
          {drill.stageCount > 1 && <em>{drill.stageCount} stages</em>}
          <em>par {clock(drill.parSeconds * 1000)}</em>
          {/* Averaged over every recorded attempt by everyone, which is the only reason it is
              worth putting next to your own. */}
          <em>avg {time(drill.averageMs)}</em>
          {drill.yourBestMs ? (
            <em className={styles.drillMine}>
              your best {time(drill.yourBestMs)}
            </em>
          ) : (
            <em>
              {drill.attempts === 0 ? "unsolved" : `${drill.attempts} solves`}
            </em>
          )}
        </span>
      </span>
      <ChevronRight size={14} />
    </button>
  );
}

/** No drill running: pick one to layer over the cluster that is already up, or draw a ranked one. */
export function DrillBrowser({
  run,
  busy,
  provisioning,
  drills,
  loading,
  act,
}: {
  run: LiveRunView;
  busy: string | null;
  provisioning: boolean;
  drills: DrillCatalogEntry[];
  loading: boolean;
  act: Act;
}) {
  const cascades = drills.filter((d) => d.stageCount > 1);
  const singles = drills.filter((d) => d.stageCount <= 1);
  const locked = busy !== null || provisioning;

  return (
    <div className={styles.scroll}>
      <p className={styles.hint}>
        A drill sets an objective and a clock on this cluster and unlocks its
        operator decisions. Nothing is reprovisioned — the workload stays up,
        and every time you record counts towards the drill&apos;s average.
      </p>

      {/* Ranked is the drawn run: you do not get to pick the cascade you are timed on. */}
      <button
        className={styles.rankedCard}
        onClick={() => act("ranked", () => startDrill(run.runId, "", "ranked"))}
        disabled={locked || cascades.length === 0}
      >
        <span className={styles.rankedIcon}>
          {busy === "ranked" ? (
            <Loader2 size={18} className={styles.spin} />
          ) : (
            <Trophy size={18} />
          )}
        </span>
        <span>
          <b>Start a ranked run</b>
          <small>
            One multi-stage cascade, drawn at random and timed. One wrong move
            ends the attempt — your time only counts if you get it clean.
          </small>
        </span>
      </button>

      {loading && (
        <p className={styles.hint}>
          <Loader2 size={12} className={styles.spin} /> Loading the catalog…
        </p>
      )}

      {cascades.length > 0 && (
        <>
          <p className={styles.group}>
            Cascades · {cascades.length}
            <span>
              Several incidents in sequence, where resolving one causes the
              next. Practising a cascade records a time but does not rank it,
              and a wrong move costs you a misstep rather than the run.
            </span>
          </p>
          <div className={styles.drills}>
            {cascades.map((d) => (
              <DrillRow
                key={d.id}
                drill={d}
                busy={busy}
                disabled={locked}
                onStart={() =>
                  act(`drill-${d.id}`, () => startDrill(run.runId, d.id))
                }
              />
            ))}
          </div>
        </>
      )}

      {singles.length > 0 && (
        <>
          <p className={styles.group}>
            Single incidents · {singles.length}
            <span>One fault, one objective. Where to learn each lever.</span>
          </p>
          <div className={styles.drills}>
            {singles.map((d) => (
              <DrillRow
                key={d.id}
                drill={d}
                busy={busy}
                disabled={locked}
                onStart={() =>
                  act(`drill-${d.id}`, () => startDrill(run.runId, d.id))
                }
              />
            ))}
          </div>
        </>
      )}

      {provisioning && (
        <p className={styles.hint}>
          Drills unlock once the workload is serving traffic.
        </p>
      )}
    </div>
  );
}
