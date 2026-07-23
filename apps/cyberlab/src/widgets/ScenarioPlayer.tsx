"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseStudy, Role, Step } from "@/entities/scenario/types";
import { ROLE_LABEL } from "@/entities/scenario/recording";
import { getPrefs, prefersReducedMotion } from "@/shared/lib/prefs";
import { Button } from "@/shared/ui/button";
import styles from "./ScenarioPlayer.module.css";

// React port of the scenario-player theater engine. The stage, narration, controls, timeline and
// steps panel are React-rendered; the per-terminal typewriter writes output imperatively into each
// terminal's body element (refs), so a fast char-by-char animation never re-renders the tree.

const esc = (s: string) =>
  s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string,
  );

function layout(terminals: CaseStudy["terminals"]) {
  const CW = 8.3,
    CH = 18;
  const boxes = terminals.map((t) => {
    const m = /^(\d+)x(\d+)(?:\+(-?\d+)\+(-?\d+))?/.exec(
      t.geometry || "100x24+0+0",
    );
    const cols = m ? +m[1] : 100,
      rows = m ? +m[2] : 24,
      x = m && m[3] ? +m[3] : 0,
      y = m && m[4] ? +m[4] : 0;
    return { x, y, w: cols * CW, h: rows * CH };
  });
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const vW = Math.max(...boxes.map((b) => b.x + b.w)) - minX;
  const vH = Math.max(...boxes.map((b) => b.y + b.h)) - minY;
  return {
    ar: `${vW} / ${vH}`,
    boxes: boxes.map((b) => ({
      left: ((b.x - minX) / vW) * 100,
      top: ((b.y - minY) / vH) * 100,
      width: (b.w / vW) * 100,
      height: (b.h / vH) * 100,
    })),
  };
}

export default function ScenarioPlayer({ study }: { study: CaseStudy }) {
  const steps = study.steps;
  const terminals = study.terminals;
  const { ar, boxes } = useMemo(() => layout(terminals), [terminals]);

  const roleOf = useCallback(
    (tid: string): Role =>
      (terminals.find((t) => t.id === tid) ?? terminals[0]).role,
    [terminals],
  );
  const promptOf = useCallback(
    (tid: string) =>
      (terminals.find((t) => t.id === tid) ?? terminals[0]).prompt,
    [terminals],
  );
  const speedOf = useCallback(
    (tid: string) =>
      (terminals.find((t) => t.id === tid) ?? terminals[0]).speed ?? 26,
    [terminals],
  );

  const [playing, setPlaying] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [activeRole, setActiveRole] = useState<Role>(terminals[0].role);
  const [narr, setNarr] = useState<{
    role: Role | null;
    text: string;
    idle: boolean;
  }>({
    role: null,
    text: "Press play to run the scenario.",
    idle: true,
  });
  const [mult, setMult] = useState(1);

  const genRef = useRef(0);
  const playingRef = useRef(false);
  const stepRef = useRef(0);
  const multRef = useRef(1);
  const bodies = useRef<Record<string, HTMLDivElement | null>>({});
  const stepsListRef = useRef<HTMLDivElement>(null);

  // NOTE: evaluated per use (not memoised) so the in-app "reduce motion" pref
  // applies immediately — prefersReducedMotion covers the OS setting too.
  const reduceMotion = typeof window !== "undefined" && prefersReducedMotion();
  useEffect(() => {
    multRef.current = mult;
  }, [mult]);

  // cosmetic pref: the speed the player STARTS at (chrome, not engine — the
  // run loop only ever reads multRef, exactly as with the manual buttons)
  useEffect(() => {
    queueMicrotask(() => setMult(getPrefs().replaySpeed));
  }, []);

  const wait = useCallback(
    (ms: number) =>
      new Promise<void>((res) =>
        setTimeout(res, reduceMotion ? Math.min(ms, 30) : ms / multRef.current),
      ),
    [reduceMotion],
  );

  const fmtOut = useCallback(
    (s: string) =>
      esc(s).replace(/§(.+?)§/g, `<span class="${styles.hi}">$1</span>`),
    [],
  );

  const appendLine = useCallback((tid: string, cls: string, html: string) => {
    const body = bodies.current[tid];
    if (!body) return;
    const div = document.createElement("div");
    div.className = cls;
    div.innerHTML = html;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }, []);

  const resetOutput = useCallback(() => {
    Object.values(bodies.current).forEach((b) => {
      if (b) b.innerHTML = "";
    });
    stepRef.current = 0;
    setStepIndex(0);
  }, []);

  const renderStepInstant = useCallback(
    (step: Step) => {
      if (step.say)
        appendLine(
          step.terminal,
          `${styles.ln} ${styles.say}`,
          "# " + esc(step.say),
        );
      if (step.run != null) {
        const prompt = esc(promptOf(step.terminal)).replace(/\n/g, "<br>");
        appendLine(
          step.terminal,
          styles.ln,
          `<span class="${styles.prompt}">${prompt}</span><span class="${styles.typed}">${esc(step.run)}</span>`,
        );
        (step.out ?? []).forEach((o) =>
          appendLine(step.terminal, `${styles.ln} ${styles.out}`, fmtOut(o)),
        );
      }
    },
    [appendLine, fmtOut, promptOf],
  );

  const scrollCurrentIntoView = useCallback(
    (i: number) => {
      const el = stepsListRef.current?.children[
        Math.min(i, steps.length - 1)
      ] as HTMLElement | undefined;
      el?.scrollIntoView({
        block: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    },
    [steps.length, reduceMotion],
  );

  const playStep = useCallback(
    async (step: Step, myGen: number) => {
      const role = roleOf(step.terminal);
      setActiveRole(role);
      setNarr({ role, text: step.say || step.run || "", idle: false });
      await wait(step.say ? 520 : 260);
      if (myGen !== genRef.current) return;

      if (step.say)
        appendLine(
          step.terminal,
          `${styles.ln} ${styles.say}`,
          "# " + esc(step.say),
        );

      if (step.run != null) {
        const prompt = esc(promptOf(step.terminal)).replace(/\n/g, "<br>");
        const body = bodies.current[step.terminal];
        const line = document.createElement("div");
        line.className = styles.ln;
        line.innerHTML = `<span class="${styles.prompt}">${prompt}</span><span class="${styles.typed}"></span><span class="${styles.caret}"></span>`;
        body?.appendChild(line);
        const typed = line.querySelector(`.${styles.typed}`) as HTMLElement;
        const caret = line.querySelector(`.${styles.caret}`) as HTMLElement;
        const delay = 1000 / speedOf(step.terminal);
        for (const ch of step.run) {
          if (myGen !== genRef.current) return;
          typed.textContent += ch;
          if (body) body.scrollTop = body.scrollHeight;
          await wait(delay);
        }
        caret.remove();
        await wait(340);
        if (myGen !== genRef.current) return;
        for (const o of step.out ?? []) {
          if (myGen !== genRef.current) return;
          appendLine(step.terminal, `${styles.ln} ${styles.out}`, fmtOut(o));
          await wait(120);
        }
      }
      await wait(step.pause_after ? step.pause_after * 1000 : 900);
    },
    [appendLine, fmtOut, promptOf, roleOf, speedOf, wait],
  );

  const play = useCallback(async () => {
    if (playingRef.current) return;
    if (stepRef.current >= steps.length) resetOutput();
    playingRef.current = true;
    setPlaying(true);
    const myGen = genRef.current;
    while (playingRef.current && stepRef.current < steps.length) {
      setStepIndex(stepRef.current);
      scrollCurrentIntoView(stepRef.current);
      await playStep(steps[stepRef.current], myGen);
      if (myGen !== genRef.current) return;
      stepRef.current += 1;
    }
    if (myGen === genRef.current) {
      playingRef.current = false;
      setPlaying(false);
      setStepIndex(stepRef.current);
      if (stepRef.current >= steps.length)
        setNarr({
          role: null,
          text: "Scenario complete. Restart to replay it.",
          idle: true,
        });
    }
  }, [playStep, resetOutput, scrollCurrentIntoView, steps]);

  const pause = useCallback(() => {
    playingRef.current = false;
    genRef.current += 1;
    setPlaying(false);
    Object.values(bodies.current).forEach((b) =>
      b?.querySelectorAll(`.${styles.caret}`).forEach((c) => c.remove()),
    );
  }, []);

  const restart = useCallback(() => {
    genRef.current += 1;
    playingRef.current = false;
    setPlaying(false);
    resetOutput();
    setActiveRole(terminals[0].role);
    setNarr({
      role: null,
      text: "Press play to run the scenario.",
      idle: true,
    });
  }, [resetOutput, terminals]);

  const scrubTo = useCallback(
    (i: number) => {
      genRef.current += 1;
      playingRef.current = false;
      setPlaying(false);
      resetOutput();
      for (let k = 0; k <= i; k++) renderStepInstant(steps[k]);
      stepRef.current = i + 1;
      setStepIndex(i + 1);
      const role = roleOf(steps[i].terminal);
      setActiveRole(role);
      setNarr({ role, text: steps[i].say || steps[i].run || "", idle: false });
      scrollCurrentIntoView(i);
    },
    [renderStepInstant, resetOutput, roleOf, scrollCurrentIntoView, steps],
  );

  // stop any run if the component unmounts
  useEffect(
    () => () => {
      genRef.current += 1;
      playingRef.current = false;
    },
    [],
  );

  const total = steps.length;
  const counter = `${String(Math.min(stepIndex + (playing ? 1 : 0), total)).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const seenRoles = terminals.filter(
    (t, i) => terminals.findIndex((x) => x.role === t.role) === i,
  );

  return (
    // the player's whole accent — controls, ticks, caret — follows whoever is acting
    <div
      className={styles.root}
      style={{
        ["--active" as string]: `var(--${activeRole})`,
        ["--accent" as string]: `var(--${activeRole})`,
      }}
    >
      <div className={styles.main}>
        <div className={styles.stageWrap}>
          <div
            className={styles.stage}
            style={{ ["--stage-ar" as string]: ar }}
          >
            {terminals.map((t, i) => (
              <div
                key={t.id}
                className={`${styles.term} ${t.role === activeRole ? styles.active : ""}`}
                style={{
                  ["--role" as string]: `var(--${t.role})`,
                  left: `${boxes[i].left}%`,
                  top: `${boxes[i].top}%`,
                  width: `${boxes[i].width}%`,
                  height: `${boxes[i].height}%`,
                }}
              >
                <div className={styles.termBar}>
                  <div className={styles.lights}>
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className={styles.termTitle}>{t.title}</div>
                  <div className={styles.roleChip}>{ROLE_LABEL[t.role]}</div>
                </div>
                <div
                  className={styles.termBody}
                  ref={(el) => {
                    bodies.current[t.id] = el;
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className={`${styles.narration} ${narr.idle ? styles.idle : ""}`}>
          <span className={styles.who}>
            {narr.idle ? "DIRECTOR" : ROLE_LABEL[narr.role ?? "operator"]}
          </span>
          <span className={styles.txt}>{narr.text}</span>
        </div>

        <div className={styles.controls}>
          <div className={styles.btns}>
            <Button onClick={() => (playing ? pause() : play())}>
              {playing ? (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
              {playing ? "Pause" : stepIndex >= total ? "Replay" : "Play"}
            </Button>
            <Button variant="secondary" onClick={restart}>
              Restart
            </Button>
          </div>
          <div className={styles.speed}>
            <label>Speed</label>
            <div className={styles.seg}>
              {[0.5, 1, 2, 4].map((m) => (
                <button
                  key={m}
                  aria-pressed={mult === m}
                  onClick={() => setMult(m)}
                >
                  {m}×
                </button>
              ))}
            </div>
          </div>
          <div className={styles.counter}>{counter}</div>
        </div>

        <div className={styles.timeline}>
          {steps.map((s, i) => (
            <button
              key={i}
              className={`${styles.tick} ${i < stepIndex ? styles.done : ""} ${i === Math.min(stepIndex, total - 1) ? styles.current : ""}`}
              style={{ ["--tick" as string]: `var(--${roleOf(s.terminal)})` }}
              title={`${i + 1}. ${ROLE_LABEL[roleOf(s.terminal)]}: ${s.say || s.run || ""}`}
              onClick={() => scrubTo(i)}
            />
          ))}
        </div>

        <div className={styles.legend}>
          {seenRoles.map((t) => (
            <span
              key={t.role}
              style={{ ["--role" as string]: `var(--${t.role})` }}
            >
              <i />
              {ROLE_LABEL[t.role]}
            </span>
          ))}
        </div>
      </div>

      <aside className={styles.steps}>
        <div className={styles.stepsHead}>
          <span>Steps</span>
          <span>{total}</span>
        </div>
        <div className={styles.stepsList} ref={stepsListRef}>
          {steps.map((s, i) => {
            const role = roleOf(s.terminal);
            const detects = (s.out ?? [])
              .filter((o) => /^§\[/.test(o))
              .map((o) => o.replace(/§/g, ""));
            const isCurrent = i === Math.min(stepIndex, total - 1);
            return (
              <button
                key={i}
                className={`${styles.stepItem} ${i < stepIndex ? styles.done : ""} ${isCurrent ? styles.current : ""}`}
                style={{ ["--role" as string]: `var(--${role})` }}
                onClick={() => scrubTo(i)}
              >
                <div className={styles.stepNum}>{i + 1}</div>
                <div className={styles.stepBody}>
                  <div className={styles.stepActor}>{ROLE_LABEL[role]}</div>
                  {s.say && <div className={styles.stepText}>{s.say}</div>}
                  {s.run != null && (
                    <div className={styles.stepCmd}>{s.run}</div>
                  )}
                  {detects.map((d, k) => (
                    <div key={k} className={styles.stepDetect}>
                      {d}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
