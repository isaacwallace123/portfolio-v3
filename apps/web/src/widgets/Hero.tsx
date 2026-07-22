"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import Counter from "@/shared/ui/Counter";
import Magnetic from "@/shared/ui/Magnetic";

// WebGL line-field — client-only, so it never SSRs.
const HeroScene = dynamic(() => import("@/widgets/HeroScene"), {
  ssr: false,
});

// Honest numbers only: facts of the network, not vanity metrics.
const STATS = [
  { value: 4, suffix: "", label: "sites, one shared session" },
  { value: 3, suffix: "", label: "working labs" },
  { value: 100, suffix: "%", label: "self-hosted, provisioned as code" },
  { value: 0, suffix: "", label: "passwords stored — OAuth only" },
] as const;

export default function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  // Apple-style dissolve: the hero content lifts + fades as it scrolls away,
  // while the network drifts the other way for depth.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -80]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const sceneY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);

  const motionText = reduce
    ? {}
    : { style: { y: contentY, opacity: contentOpacity } };
  const motionScene = reduce ? {} : { style: { y: sceneY, scale: sceneScale } };

  return (
    <section
      ref={ref}
      className="relative flex min-h-[clamp(600px,90vh,940px)] flex-col justify-center overflow-hidden"
    >
      {/* full-bleed line-field, kept to the right of the headline purely by its own mask — no
          paper scrim overlay, because an alpha gradient over the flat dark ground composites with
          8-bit rounding into faint vertical banding. The mask hides the canvas where there's no
          content (transparent stays transparent → no banding); the text sits over clean ground. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 [mask-image:linear-gradient(100deg,transparent_0%,transparent_56%,#000_100%)]"
        {...motionScene}
      >
        <HeroScene />
      </motion.div>

      <motion.div className="shell relative z-10" {...motionText}>
        <div
          className="eyebrow rise-in"
          style={{ ["--rise-delay" as string]: "0ms" }}
        >
          Infrastructure · Security · AI
        </div>
        <h1 className="mt-5 max-w-[26ch] font-display text-[clamp(44px,8vw,92px)] leading-[0.98] font-bold tracking-[-0.03em]">
          <span
            className="rise-in block"
            style={{ ["--rise-delay" as string]: "90ms" }}
          >
            <em className="draw-underline text-accent not-italic">Live</em>{" "}
            systems,
          </span>
          <span
            className="rise-in block"
            style={{ ["--rise-delay" as string]: "200ms" }}
          >
            not screenshots.
          </span>
        </h1>
        <p
          className="rise-in mt-8 max-w-[52ch] text-[clamp(16px,1.5vw,20px)] leading-relaxed text-ink-mid"
          style={{ ["--rise-delay" as string]: "340ms" }}
        >
          I&apos;m Isaac. Every piece of this network is a{" "}
          <strong className="font-semibold text-ink">live system</strong> on
          self-hosted infrastructure — a cyber range you can watch mid-attack,
          the DevOps that runs it all, an AI lab, and one account that signs you
          into every site.
        </p>
        <div
          className="rise-in mt-9 flex flex-wrap gap-3"
          style={{ ["--rise-delay" as string]: "440ms" }}
        >
          <Magnetic>
            <a
              href="#labs"
              className="inline-flex h-(--ctl-lg) items-center gap-2 rounded-md bg-ink px-5 text-[15px] font-semibold text-paper transition-opacity duration-(--dur-fast) outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-accent/50 active:translate-y-px"
            >
              Explore the labs
              <span aria-hidden>↓</span>
            </a>
          </Magnetic>
          <Magnetic>
            <a
              href="#network"
              className="inline-flex h-(--ctl-lg) items-center gap-2 rounded-md border border-line bg-card/80 px-5 text-[15px] font-semibold text-ink backdrop-blur-sm transition-[border-color,background-color] duration-(--dur-fast) outline-none hover:border-line-2 hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-accent/50 active:translate-y-px"
            >
              How it fits together
            </a>
          </Magnetic>
        </div>
      </motion.div>

      {/* stat band — pinned to the bottom of the hero */}
      <div className="shell relative z-10 mt-[clamp(40px,7vw,88px)]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line pt-8 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label}>
              <dt className="sr-only">{s.label}</dt>
              <dd className="font-display text-[clamp(28px,3.6vw,42px)] leading-none font-bold text-ink">
                <Counter to={s.value} suffix={s.suffix} />
              </dd>
              <dd className="mt-2 text-[13px] leading-snug text-ink-dim">
                {s.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
