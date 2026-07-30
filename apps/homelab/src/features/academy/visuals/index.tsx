"use client";

import { FlaskConical } from "lucide-react";
import { ILLUSTRATIVE_NOTE, type VisualId } from "../model/course";
import { useAnimationAllowed } from "../model/motion";
import {
  DesiredVsObserved,
  OfferedVsServed,
  ReplicaConvergence,
} from "./CapacityLessons";
import {
  CacheFlow,
  CanarySplit,
  DrainMigration,
  GoalHold,
  ReleaseTracks,
} from "./DeliveryLessons";
import { RequestPathLesson } from "./RequestPathLesson";
import styles from "./visuals.module.css";

// The registry.
//
// Content names a diagram by id; nothing in `content/` imports React. That is what keeps a new
// lesson to an entry in a data file rather than a new page component, and it is why every visual
// takes the same two inputs: whether motion is allowed, and the value of the control (if any).

export interface VisualProps {
  animate: boolean;
  value?: number;
}

const REGISTRY: Record<VisualId, (props: VisualProps) => React.ReactElement> = {
  "request-path": (p) => <RequestPathLesson {...p} variant="path" />,
  "queue-formation": (p) => <RequestPathLesson {...p} variant="queue" />,
  "gateway-queue": (p) => <RequestPathLesson {...p} variant="gateway" />,
  "offered-vs-served": (p) => <OfferedVsServed animate={p.animate} />,
  "desired-vs-observed": (p) => <DesiredVsObserved animate={p.animate} />,
  "replica-convergence": (p) => <ReplicaConvergence {...p} />,
  "release-tracks": (p) => <ReleaseTracks animate={p.animate} />,
  "cache-flow": (p) => <CacheFlow animate={p.animate} />,
  "drain-migration": (p) => <DrainMigration {...p} />,
  "canary-split": (p) => <CanarySplit {...p} />,
  "goal-hold": (p) => <GoalHold animate={p.animate} />,
};

/**
 * A diagram in its frame, labelled as an illustration.
 *
 * The badge is not decoration and not a disclaimer bolted on afterwards. This course also runs real
 * drills against real telemetry, and a learner has to be able to tell at a glance which of the two
 * they are looking at — otherwise the first thing the Academy teaches is that charts on this site
 * may or may not be measurements.
 */
export function LessonVisual({
  title,
  caption,
  visual,
  value,
}: {
  title: string;
  caption: string;
  visual: VisualId;
  value?: number;
}) {
  const animate = useAnimationAllowed();
  const Diagram = REGISTRY[visual];

  return (
    <figure className={styles.frame}>
      <div className={styles.frameHead}>
        <h4>{title}</h4>
        <span className={styles.illustrative} title={ILLUSTRATIVE_NOTE}>
          <FlaskConical size={10} aria-hidden />
          Example
        </span>
      </div>
      <Diagram animate={animate} value={value} />
      <figcaption className={styles.caption}>{caption}</figcaption>
      {/* Read out by screen readers and hidden from nobody: the visual badge above is a glance,
          this is the sentence. */}
      <p className={styles.caption}>
        <small>{ILLUSTRATIVE_NOTE}</small>
      </p>
    </figure>
  );
}

/** The same diagram with a dial attached. The learner drives it; nothing here touches a cluster. */
export function GuidedVisual({
  title,
  caption,
  visual,
  control,
  observe,
  value,
  onChange,
}: {
  title: string;
  caption: string;
  visual: VisualId;
  control: {
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  };
  observe: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const animate = useAnimationAllowed();
  const Diagram = REGISTRY[visual];
  const inputId = `guided-${visual}`;

  return (
    <figure className={styles.frame}>
      <div className={styles.frameHead}>
        <h4>{title}</h4>
        <span className={styles.illustrative} title={ILLUSTRATIVE_NOTE}>
          <FlaskConical size={10} aria-hidden />
          Example
        </span>
      </div>
      <Diagram animate={animate} value={value} />

      <div className={styles.control}>
        <div className={styles.controlHead}>
          <label htmlFor={inputId}>{control.label}</label>
          <b>
            {value} {control.unit}
          </b>
        </div>
        <input
          id={inputId}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>

      <figcaption className={styles.caption}>{caption}</figcaption>
      <p className={styles.observe}>
        <b>Watch for:</b> {observe}
      </p>
      <p className={styles.caption}>
        <small>{ILLUSTRATIVE_NOTE}</small>
      </p>
    </figure>
  );
}

export { RequestPathLesson, pathState } from "./RequestPathLesson";
