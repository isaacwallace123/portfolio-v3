"use client";

import type { SkillState } from "../model/progress";
import styles from "./academy.module.css";

/**
 * Domain mastery across the course.
 *
 * This is Academy mastery, and it is not a rating. There is no ELO here, nothing is compared with
 * anyone else, and it never moves down. The bar is weighted so that reading everything without
 * touching a cluster tops out below half — a skill is "demonstrated" when its capstone was solved
 * on real infrastructure, and the label says exactly that rather than implying more.
 */
export function SkillProfile({ skills }: { skills: SkillState[] }) {
  return (
    <div className={styles.skills}>
      {skills.map((skill) => (
        <div
          key={skill.domain}
          className={styles.skill}
          data-demonstrated={skill.demonstrated}
        >
          <div className={styles.skillHead}>
            <span style={{ color: "var(--ink)" }}>{skill.label}</span>
            <span>{Math.round(skill.level * 100)}%</span>
          </div>
          <div
            className={styles.skillTrack}
            role="meter"
            aria-valuenow={Math.round(skill.level * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${skill.label} mastery`}
          >
            <div
              className={styles.skillFill}
              style={{ width: `${Math.max(2, skill.level * 100)}%` }}
            />
          </div>
          <p className={styles.skillNote}>
            {skill.demonstrated
              ? "Demonstrated on a real cluster"
              : "Not yet proven on a cluster"}
          </p>
        </div>
      ))}
    </div>
  );
}
