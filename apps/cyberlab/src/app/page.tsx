import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Crosshair,
  Eye,
  LockKeyhole,
  Network,
  Radio,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import CaseStudyCard from "@/widgets/CaseStudyCard";
import Reveal from "@/shared/ui/Reveal";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { getCaseStudies, getFeatured } from "@/entities/scenario/scenarios";

const PERSPECTIVES: Array<{
  role: "attacker" | "responder" | "hardener";
  index: string;
  kicker: string;
  title: string;
  body: string;
  icon: LucideIcon;
  signal: string;
}> = [
  {
    role: "attacker",
    index: "01",
    kicker: "Offense",
    title: "Compromise the target",
    body: "Follow the real recon, exploitation, and post-exploitation commands issued from Kali against disposable victim VMs.",
    icon: Crosshair,
    signal: "TTPs + raw output",
  },
  {
    role: "responder",
    index: "02",
    kicker: "Detection",
    title: "Watch the SOC react",
    body: "See which telemetry reached Wazuh, which rules fired, and how the defender separated useful signal from noise.",
    icon: Eye,
    signal: "Alerts + evidence",
  },
  {
    role: "hardener",
    index: "03",
    kicker: "Hardening",
    title: "Close the path",
    body: "Replay the remediation, validate the control, and prove the same attack chain no longer reaches its objective.",
    icon: LockKeyhole,
    signal: "Fixes + verification",
  },
];

const PIPELINE = ["Provision", "Exploit", "Observe", "Contain", "Explain"];

export default function Home() {
  const featured = getFeatured();
  const all = getCaseStudies();
  const captures = all.filter((study) => study.recorded).length;
  const steps = all.reduce((count, study) => count + study.steps.length, 0);
  const detections = all.reduce(
    (count, study) =>
      count +
      study.steps.reduce(
        (stepCount, step) =>
          stepCount +
          (step.out ?? []).filter((line) => /^§\[/.test(line)).length,
        0,
      ),
    0,
  );

  const stats = [
    { label: "case studies", value: all.length },
    { label: "real captures", value: captures },
    { label: "recorded steps", value: steps },
    { label: "detections shown", value: detections },
  ];

  return (
    <>
      <section className="cyber-hero" id="top">
        <div className="cyber-bloom cyber-bloom-red" />
        <div className="cyber-bloom cyber-bloom-cyan" />
        <div className="cyber-hero-grid">
          <div className="cyber-hero-copy">
            <p className="cyber-kicker">
              <Radio aria-hidden /> Real machines · isolated networks · live
              evidence
            </p>
            <h1>
              See the intrusion.
              <br />
              <span>Understand the response.</span>
            </h1>
            <p className="cyber-lede">
              Enter a self-hosted cyber range where Kali, victim systems, and a
              Wazuh SOC execute the whole attack-and-defend loop on real VMs.
              Watch live, then replay every command, alert, decision, and fix.
            </p>
            <div className="cyber-actions">
              <Button asChild size="lg">
                <Link href="/live">
                  <Activity aria-hidden data-icon="inline-start" />
                  Enter the live range
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/scenarios">
                  Explore case studies
                  <ArrowRight aria-hidden data-icon="inline-end" />
                </Link>
              </Button>
            </div>
          </div>

          <Reveal delay={100}>
            <div className="range-theatre">
              <header>
                <span>
                  <Network aria-hidden /> RANGE / RUN-042
                </span>
                <Badge variant="outline">observed</Badge>
              </header>

              <div
                className="range-map"
                aria-label="Attack path from Kali through the victim to Wazuh"
              >
                <div className="range-node node-attacker">
                  <Terminal aria-hidden />
                  <small>ATTACKER</small>
                  <b>Kali</b>
                  <code>10.40.8.12</code>
                </div>
                <div className="range-link link-hostile">
                  <i />
                  <span>CVE-2021-41773</span>
                </div>
                <div className="range-node node-victim">
                  <Activity aria-hidden />
                  <small>TARGET</small>
                  <b>web-01</b>
                  <code>apache / linux</code>
                </div>
                <div className="range-link link-observed">
                  <i />
                  <span>events / syslog</span>
                </div>
                <div className="range-node node-responder">
                  <ShieldCheck aria-hidden />
                  <small>DEFENDER</small>
                  <b>Wazuh SOC</b>
                  <code>rule 31103</code>
                </div>
              </div>

              <div className="range-terminal">
                <div>
                  <time>21:08:12</time>
                  <span className="text-attacker">ATTACK</span>
                  <code>path traversal probe reached web-01</code>
                </div>
                <div>
                  <time>21:08:14</time>
                  <span className="text-responder">DETECT</span>
                  <code>Wazuh decoded suspicious URI pattern</code>
                </div>
                <div>
                  <time>21:08:19</time>
                  <span className="text-hardener">HARDEN</span>
                  <code>containment playbook ready for approval</code>
                </div>
              </div>

              <footer>
                <span>
                  <i className="bg-responder" /> 3 actors online
                </span>
                <span>packet capture · enabled</span>
              </footer>
            </div>
          </Reveal>
        </div>

        <Reveal delay={160}>
          <dl className="cyber-stats">
            {stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      <section className="cyber-section" id="method">
        <Reveal>
          <div className="cyber-heading">
            <div>
              <p className="cyber-kicker">One run · three perspectives</p>
              <h2>The whole incident, not just the exploit.</h2>
            </div>
            <p>
              Each scenario preserves what every actor saw, when they saw it,
              and why the next decision changed the outcome.
            </p>
          </div>
        </Reveal>

        <div className="perspective-grid">
          {PERSPECTIVES.map((perspective, index) => {
            const Icon = perspective.icon;
            return (
              <Reveal key={perspective.role} delay={index * 80}>
                <Card
                  className="perspective-card"
                  style={{ ["--role" as string]: `var(--${perspective.role})` }}
                >
                  <CardHeader>
                    <div className="perspective-meta">
                      <span>{perspective.index}</span>
                      <Icon aria-hidden />
                    </div>
                    <CardDescription>{perspective.kicker}</CardDescription>
                    <CardTitle>{perspective.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>{perspective.body}</p>
                    <Badge variant="outline">{perspective.signal}</Badge>
                  </CardContent>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="evidence-section">
        <Reveal>
          <div className="evidence-copy">
            <p className="cyber-kicker">Evidence pipeline</p>
            <h2>Real input. Recorded output. Reproducible conclusions.</h2>
            <p>
              The range is provisioned as code, executed against disposable
              machines, observed by the SOC, and converted into an inspectable
              case study. Public controls stay allowlisted and personal
              workloads never enter the scenario network.
            </p>
            <Button asChild variant="secondary">
              <Link href="/scenarios">
                Inspect the evidence
                <ArrowRight aria-hidden data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={90}>
          <div className="evidence-pipeline">
            <header>
              <span>SCENARIO PIPELINE</span>
              <Badge variant="outline">public-safe</Badge>
            </header>
            <ol>
              {PIPELINE.map((phase, index) => (
                <li key={phase}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{phase}</b>
                    <small>
                      {index === 4 ? "case study" : "evidence retained"}
                    </small>
                  </div>
                  {index < PIPELINE.length - 1 && <i aria-hidden />}
                </li>
              ))}
            </ol>
            <footer>
              <span>
                <i className="bg-attacker" /> PCAP
              </span>
              <span>
                <i className="bg-responder" /> WAZUH
              </span>
              <span>
                <i className="bg-hardener" /> PLAYBOOKS
              </span>
            </footer>
          </div>
        </Reveal>
      </section>

      <section className="cyber-section" id="case-studies">
        <Reveal>
          <div className="cyber-heading">
            <div>
              <p className="cyber-kicker">Recorded operations</p>
              <h2>Start with a real run.</h2>
            </div>
            <p>
              Step through the commands, detections, and remediation with the
              original output still attached.
            </p>
          </div>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((study, index) => (
            <Reveal key={study.id} delay={index * 80} className="h-full">
              <CaseStudyCard study={study} />
            </Reveal>
          ))}
        </div>
        <div className="mt-6">
          <Button asChild variant="secondary">
            <Link href="/scenarios">
              View every case study
              <ArrowRight aria-hidden data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
