"use client";

import { CircleSlash, Loader2, Lock } from "lucide-react";
import { RangeSlider } from "@iw/ui";
import { practiceAction, type LiveRunView } from "@/shared/lib/liveClient";
import { CONTROLS, SLIDERS } from "../model/controls";
import styles from "../workbench.module.css";

/** Every allowlisted change the operator can make to a live cluster. */
export function ControlsPanel({
  run,
  busy,
  act,
}: {
  run: LiveRunView;
  busy: string | null;
  act: (
    key: string,
    fn: () => Promise<LiveRunView | void>,
    optimistic?: (r: LiveRunView) => LiveRunView,
  ) => void;
}) {
  return (
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
                  className={`${activeId === o.id ? styles.segOn : ""} ${
                    busy === o.id ? styles.pending : ""
                  }`}
                  onClick={() =>
                    act(o.id, () => practiceAction(run.runId, o.id), o.apply)
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
        <Lock size={12} /> Private to your account. <CircleSlash size={12} />{" "}
        Egress denied by default.
      </p>
    </div>
  );
}
