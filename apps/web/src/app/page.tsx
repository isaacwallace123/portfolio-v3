import Hero from "@/widgets/Hero";
import NetworkDiagram from "@/widgets/NetworkDiagram";
import Parallax from "@/shared/ui/Parallax";
import ScrollReveal from "@/shared/ui/ScrollReveal";
import { AILAB_URL, CYBERLAB_URL, HOMELAB_URL } from "@iw/core";

// One card per site in the network. In dev the links point at local ports (SSO works there too —
// cookies ignore ports); in production they point at the real subdomains.
const LABS = [
  {
    key: "cyber",
    name: "cyberlab",
    domain: "cyberlab.isaacwallace.dev",
    href: CYBERLAB_URL,
    color: "var(--lab-cyber)",
    status: "live",
    blurb:
      "A self-hosted cyber range on Proxmox: real attacks and defenses on isolated VMs, recorded and replayed as step-by-step case studies — plus a live view of scenarios running now.",
  },
  {
    key: "homelab",
    name: "homelab",
    domain: "homelab.isaacwallace.dev",
    href: HOMELAB_URL,
    color: "var(--lab-homelab)",
    status: "live",
    blurb:
      "An interactive SRE arena on the infrastructure that runs everything else. Enter a disposable Kubernetes incident, read live signals, operate the platform, and inspect the evidence.",
  },
  {
    key: "ailab",
    name: "ailab",
    domain: "ailab.isaacwallace.dev",
    href: AILAB_URL,
    color: "var(--lab-ailab)",
    status: "live",
    blurb:
      "A visual local-model workbench: configure dual-agent experiments, inspect tool traces and GPU telemetry, compare artifacts, and audit the evaluation pipeline.",
  },
] as const;

// The four disciplines this network demonstrates — every claim is something
// running in this repo family, not an aspiration.
const DISCIPLINES = [
  {
    key: "auth",
    color: "var(--lab-main)",
    kicker: "Identity & auth",
    title: "Real SSO, built from scratch",
    facts: [
      "Delegated OAuth (Google / GitHub) — zero passwords stored, nothing to crack",
      "One HttpOnly cookie on .isaacwallace.dev signs you into every site",
      "Server-side sessions — see every device and revoke any of them, instantly",
      "Role-based control plane, allow-listed admins, rate-limited endpoints",
      "Integration-tested end to end with real cookies (xunit)",
    ],
    hint: "Try it: account menu → Settings → Sessions",
  },
  {
    key: "security",
    color: "var(--lab-cyber)",
    kicker: "Cybersecurity",
    title: "An owned range, attacked properly",
    facts: [
      "Isolated attack networks on Proxmox — Kali, victims, a Wazuh SOC",
      "Real attack-and-defend runs, recorded and replayed as case studies",
      "Public views are read-only by design; the lab is never exposed",
      "Admin plane gated at the edge (Cloudflare Access) + server-side roles",
      "CORS locked to known origins; session revocation kills stolen cookies",
    ],
    hint: "See it live on cyberlab",
  },
  {
    key: "devops",
    color: "var(--lab-homelab)",
    kicker: "DevOps",
    title: "GitOps from laptop to cluster",
    facts: [
      "Everything as code: Terraform, Ansible, Packer on Proxmox",
      "git push → CI → GHCR image → ArgoCD → k3s, hands-off",
      "Served through a Cloudflare tunnel — zero open ports",
      "Healthchecked containers; compose locally, Kubernetes in prod",
      "Sealed Secrets — plaintext never touches git",
    ],
    hint: "Operate a production incident in HomeOps",
  },
  {
    key: "ai",
    color: "var(--lab-ailab)",
    kicker: "AI",
    title: "Applied LLM systems, self-hosted",
    facts: [
      "Agents and applied LLM workflows on owned infrastructure",
      "Evaluation-first: measure before shipping",
      "Same platform standards as every lab — containerised, GitOps-deployed",
      "GPU workloads stay off-cluster, reached like the cyber range: narrowly",
    ],
    hint: "Run a dual-agent evaluation in AI Lab",
  },
] as const;

export default function Home() {
  return (
    <>
      <Hero />

      {/* The network */}
      <section
        id="labs"
        className="shell scroll-mt-20 py-[clamp(40px,7vw,88px)]"
      >
        <ScrollReveal>
          <div className="mb-8 flex flex-col gap-2">
            <div className="eyebrow">The labs</div>
            <h2 className="font-display text-(length:--fs-h1) font-bold tracking-[-0.015em]">
              One network, four sites
            </h2>
          </div>
        </ScrollReveal>
        <div className="grid gap-4 md:grid-cols-3">
          {LABS.map((lab) => (
            <ScrollReveal key={lab.key} y={56} className="h-full">
              <a
                href={lab.href}
                className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border border-line bg-card p-6 shadow-(--shadow-1) transition-[border-color,box-shadow,transform] duration-(--dur-base) ease-(--ease-out) before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:origin-left before:scale-x-30 before:bg-(--lab) before:transition-transform before:duration-(--dur-slow) hover:translate-y-[-5px] hover:border-(--lab) hover:shadow-(--shadow-2) hover:before:scale-x-100 focus-visible:ring-2 focus-visible:ring-accent/50"
                style={{ ["--lab" as string]: lab.color }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full bg-(--lab)"
                  />
                  <span className="font-mono text-sm font-bold text-ink">
                    {lab.name}
                  </span>
                  <span
                    className={
                      lab.status === "live"
                        ? "ml-auto rounded-full border border-(--lab) px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-(--lab) uppercase"
                        : "ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-ink-dim uppercase"
                    }
                  >
                    {lab.status === "live" ? "Live" : "Building"}
                  </span>
                </div>
                <div className="font-mono text-[11.5px] text-ink-dim">
                  {lab.domain}
                </div>
                <p className="text-sm leading-relaxed text-ink-mid">
                  {lab.blurb}
                </p>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-(--lab) opacity-0 transition-[opacity,gap] duration-(--dur-base) group-hover:gap-2 group-hover:opacity-100 group-focus-visible:opacity-100">
                  Visit <span aria-hidden>→</span>
                </span>
              </a>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* How it fits together — the animated network diagram, gently parallaxed */}
      <section
        id="network"
        className="shell scroll-mt-20 py-[clamp(44px,8vw,96px)]"
      >
        <ScrollReveal>
          <div className="mb-8 flex flex-col gap-2">
            <div className="eyebrow">Under the hood</div>
            <h2 className="font-display text-(length:--fs-h1) font-bold tracking-[-0.015em]">
              One account, every site
            </h2>
            <p className="max-w-[68ch] text-[15px] text-ink-mid">
              Every site talks to the same ASP.NET Core API, and one session
              cookie on{" "}
              <span className="font-mono text-[13px]">.isaacwallace.dev</span>{" "}
              signs you into all of them. No passwords are stored anywhere —
              identity is delegated to Google or GitHub.
            </p>
          </div>
        </ScrollReveal>
        <ScrollReveal y={64} scaleFrom={0.94}>
          <Parallax speed={0.08}>
            <div className="rounded-xl border border-line bg-card p-[clamp(12px,3vw,28px)] shadow-(--shadow-1)">
              <NetworkDiagram />
            </div>
          </Parallax>
        </ScrollReveal>
      </section>

      {/* The four disciplines — the flex, each line running for real */}
      <section
        id="stack"
        className="shell scroll-mt-20 py-[clamp(44px,8vw,96px)]"
      >
        <ScrollReveal>
          <div className="mb-8 flex flex-col gap-2">
            <div className="eyebrow">The stack</div>
            <h2 className="font-display text-(length:--fs-h1) font-bold tracking-[-0.015em]">
              Four disciplines, one working system
            </h2>
            <p className="max-w-[68ch] text-[15px] text-ink-mid">
              Nothing below is a bullet point from a résumé — each claim is
              running in this network right now, with the source to prove it.
            </p>
          </div>
        </ScrollReveal>
        <div className="grid gap-4 md:grid-cols-2">
          {DISCIPLINES.map((d) => (
            <ScrollReveal key={d.key} y={56} className="h-full">
              <div
                className="group flex h-full flex-col gap-3 rounded-xl border border-line bg-card p-6 shadow-(--shadow-1) transition-[border-color,box-shadow,transform] duration-(--dur-base) hover:translate-y-[-4px] hover:border-(--pillar) hover:shadow-(--shadow-2)"
                style={{ ["--pillar" as string]: d.color }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full bg-(--pillar)"
                  />
                  <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-(--pillar) uppercase">
                    {d.kicker}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold tracking-[-0.01em]">
                  {d.title}
                </h3>
                <ul className="flex flex-col gap-2">
                  {d.facts.map((f) => (
                    <li
                      key={f}
                      className="flex gap-2.5 text-sm leading-relaxed text-ink-mid"
                    >
                      <span
                        aria-hidden
                        className="mt-[7px] size-1.5 shrink-0 rounded-full bg-(--pillar) opacity-60"
                      />
                      {f}
                    </li>
                  ))}
                </ul>
                <span className="mt-auto pt-1 font-mono text-[11px] tracking-[0.06em] text-ink-dim">
                  {d.hint}
                </span>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* About */}
      <section
        id="about"
        className="shell scroll-mt-20 py-[clamp(44px,8vw,96px)]"
      >
        <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
          <ScrollReveal>
            <div>
              <div className="eyebrow">About</div>
              <h2 className="mt-2 font-display text-(length:--fs-h1) font-bold tracking-[-0.015em]">
                Built, not told
              </h2>
            </div>
          </ScrollReveal>
          <ScrollReveal y={40}>
            <div className="space-y-4 text-[15.5px] leading-relaxed text-ink-mid">
              <p>
                The premise of this portfolio is that showing beats telling. The
                cyber range runs real attacks against real services and records
                them. The homelab is the actual infrastructure everything here
                runs on. The AI lab experiments run against the same stack.
                Nothing is a mock-up.
              </p>
              <p>
                It&apos;s all provisioned as code — Terraform, Ansible, Packer
                on Proxmox — fronted by Cloudflare, with the labs reachable only
                through read-only, sanitised public views. The source of every
                site in the network is part of the portfolio too.
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}
