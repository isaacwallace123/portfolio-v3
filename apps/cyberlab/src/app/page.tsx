import Link from "next/link";
import { ArrowRight } from "lucide-react";
import CaseStudyCard from "@/widgets/CaseStudyCard";
import Reveal from "@/shared/ui/Reveal";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { getCaseStudies, getFeatured } from "@/entities/scenario/scenarios";

const FEATURES = [
  {
    role: "attacker",
    kicker: "The range",
    title: "Real VMs, isolated networks",
    body: (
      <>
        Kali attackers, Windows and Ubuntu targets, and a Wazuh SOC —
        provisioned as code (Terraform, Ansible, Packer) on Proxmox, segmented
        so attacks stay inside owned lab networks and never touch anything real.
      </>
    ),
  },
  {
    role: "responder",
    kicker: "Two phases",
    title: "Run it, then replay it",
    body: (
      <>
        Phase one runs a scenario on the VMs and records every action of every
        actor. Phase two is what you&apos;re looking at: those recordings
        replayed as explained, step-by-step case studies — with the real command
        output captured from the run.
      </>
    ),
  },
  {
    role: "hardener",
    kicker: "Three hats",
    title: "Attack, detect, harden",
    body: (
      <>
        Scenarios are told from every side at once: the{" "}
        <span className="text-attacker">black hat</span> attacking, the{" "}
        <span className="text-responder">white hat</span> detecting and
        responding, and the <span className="text-hardener">red hat</span>{" "}
        hardening so it can&apos;t happen again.
      </>
    ),
  },
] as const;

export default function Home() {
  const featured = getFeatured();
  const all = getCaseStudies();
  const captures = all.filter((s) => s.recorded).length;
  const steps = all.reduce((n, s) => n + s.steps.length, 0);
  const detections = all.reduce(
    (n, s) =>
      n +
      s.steps.reduce(
        (k, st) => k + (st.out ?? []).filter((o) => /^§\[/.test(o)).length,
        0,
      ),
    0,
  );

  const STATS = [
    { label: "case studies", value: all.length },
    { label: "real captures", value: captures },
    { label: "recorded steps", value: steps },
    { label: "detections shown", value: detections },
  ];

  return (
    <>
      {/* Hero */}
      <section className="shell pt-[clamp(48px,9vw,104px)] pb-[clamp(30px,5vw,56px)]">
        <div className="eyebrow">Self-hosted cyber range · Proxmox</div>
        <h1 className="mt-4 text-[clamp(30px,5.4vw,56px)] leading-[1.05] font-extrabold tracking-[-0.02em]">
          Watch attacks and defenses
          <br />
          play out on{" "}
          <span className="text-[color-mix(in_srgb,var(--attacker)_85%,#fff)]">
            real
          </span>{" "}
          machines.
        </h1>
        <p className="mt-[18px] max-w-[66ch] text-[clamp(15px,2vw,19px)] leading-[1.55] text-ink-mid">
          cyberlab is a self-hosted cyber range: attackers, defenders, and
          victim systems on isolated networks, running real tools on real VMs.
          Scenarios are executed on the lab and{" "}
          <strong className="font-semibold text-ink">recorded</strong> — then
          replayed here as case studies you can step through, or watched live as
          they run.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/scenarios">
              Browse case studies
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/live">
              <span
                aria-hidden
                className="size-[7px] animate-blip rounded-full bg-attacker"
              />
              See what&apos;s running now
            </Link>
          </Button>
        </div>

        {/* range status strip — real numbers derived from the registry */}
        <Reveal delay={140}>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg border border-line-soft bg-panel px-5 py-4">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.2em] text-responder uppercase">
              <span
                aria-hidden
                className="size-[7px] animate-blip rounded-full bg-responder"
              />
              range telemetry
            </span>
            {STATS.map((s) => (
              <span key={s.label} className="inline-flex items-baseline gap-2">
                <span className="font-mono text-lg font-bold text-ink tabular-nums">
                  {s.value}
                </span>
                <span className="font-mono text-[10px] tracking-[0.14em] text-ink-dim uppercase">
                  {s.label}
                </span>
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* What it is / how it works */}
      <section className="shell py-[clamp(28px,4vw,48px)]">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.kicker} delay={i * 70}>
              <Card
                className="h-full gap-2.5 transition-colors duration-(--dur-base) hover:border-[color-mix(in_srgb,var(--role)_40%,var(--line))]"
                style={{ ["--role" as string]: `var(--${f.role})` }}
              >
                <CardHeader className="gap-2.5">
                  <span className="font-mono text-[10px] font-bold tracking-[0.22em] text-(--role) uppercase">
                    {f.kicker}
                  </span>
                  <CardTitle className="text-base">{f.title}</CardTitle>
                </CardHeader>
                <CardContent className="pb-5 text-sm leading-[1.55] text-ink-mid">
                  {f.body}
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Purpose */}
      <section className="shell py-[clamp(28px,4vw,48px)]">
        <Reveal>
          <div className="mb-6 flex flex-col gap-2">
            <div className="eyebrow">Why it exists</div>
            <h2 className="text-[clamp(21px,3vw,30px)] font-bold tracking-[-0.01em]">
              A cyber range you can actually see
            </h2>
          </div>
        </Reveal>
        <Reveal delay={70}>
          <div className="max-w-[68ch] space-y-3.5 text-[15.5px] leading-[1.65] text-ink-mid">
            <p>
              Most security work is invisible — logs, alerts, terminals no one
              else watches. cyberlab exists to make the whole loop{" "}
              <strong className="font-semibold text-ink">legible</strong>: to
              run a real attack against real services, catch it with real
              monitoring, respond, and harden — and then show that entire
              timeline in a way someone can follow without being in the room.
            </p>
            <p>
              It doubles as a working portfolio and a practice ground. Every
              case study here was executed on the lab, not mocked up — the
              recordings carry the actual output, timing, and detections from
              the run, so what you watch is what happened.
            </p>
          </div>
        </Reveal>
      </section>

      {/* Featured case studies */}
      <section className="shell py-[clamp(28px,4vw,48px)]">
        <Reveal>
          <div className="mb-6 flex flex-col gap-2">
            <div className="eyebrow">Case studies</div>
            <h2 className="text-[clamp(21px,3vw,30px)] font-bold tracking-[-0.01em]">
              Start with these
            </h2>
            <p className="max-w-[72ch] text-[15px] text-ink-mid">
              Each one replays step by step, with every command and detection
              explained alongside.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((s, i) => (
            <Reveal key={s.id} delay={i * 70} className="h-full">
              <CaseStudyCard study={s} />
            </Reveal>
          ))}
        </div>
        <div className="mt-5">
          <Button asChild variant="secondary">
            <Link href="/scenarios">
              All case studies
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
