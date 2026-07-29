"use client";

import { Loader2, Timer } from "lucide-react";
import { clock } from "@/shared/lib/format";
import styles from "../workbench.module.css";

/**
 * Offered in the cluster's last minute, and only if the one permitted extension is still unspent.
 * Late enough to be a real decision, early enough to act on. Declining is fine — the cluster then
 * ends on schedule, which it does regardless once the extension is used.
 */
export function RenewalModal({
  remainingMs,
  busy,
  onRenew,
  onDismiss,
}: {
  remainingMs: number;
  busy: string | null;
  onRenew: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.modalScrim} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <span className={styles.modalIcon}>
          <Timer size={18} />
        </span>
        <h3>This cluster closes in {clock(remainingMs)}</h3>
        <p>
          Everything running on it — the workload, the drill you are in, the
          activity so far — goes with it. You can add another 15 minutes, once.
          After that it closes for good.
        </p>
        <div className={styles.modalActions}>
          <button
            className={styles.primary}
            onClick={onRenew}
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
            onClick={onDismiss}
            disabled={busy !== null}
          >
            Let it close
          </button>
        </div>
      </div>
    </div>
  );
}
