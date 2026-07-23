"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { AILAB_URL, CYBERLAB_URL, HOMELAB_URL, HOME_URL } from "@iw/core";
import { listRoles, listUsers } from "@/shared/api/adminApi";
import PageHead from "@/shared/ui/PageHead";

const SYSTEMS = [
  {
    name: "Kubernetes fabric",
    description: "k3s control plane, workloads, storage, and observability",
    status: "3 nodes ready",
    metric: "41 pods",
    href: "/servers",
    publicHref: HOMELAB_URL,
    tone: "#43d990",
  },
  {
    name: "Cyber range",
    description: "Scenario queue, disposable VMs, recordings, and evidence",
    status: "Range idle",
    metric: "4 templates",
    href: "/cyberlab",
    publicHref: CYBERLAB_URL,
    tone: "#ff9450",
  },
  {
    name: "AI platform",
    description: "GPU workers, model gateway, RAG collections, and evaluations",
    status: "2 workers ready",
    metric: "6 models",
    href: "/ai",
    publicHref: AILAB_URL,
    tone: "#a88cff",
  },
  {
    name: "Portfolio network",
    description: "Applications, identity, delivery state, and public endpoints",
    status: "4 sites online",
    metric: "0 drift",
    href: "/projects",
    publicHref: HOME_URL,
    tone: "#7185ff",
  },
] as const;

const NODES = [
  { name: "k3s-control-01", role: "control", cpu: 28, memory: 46, pods: 14 },
  { name: "k3s-worker-01", role: "compute", cpu: 41, memory: 62, pods: 17 },
  { name: "gpu-worker-01", role: "accelerator", cpu: 19, memory: 54, pods: 10 },
];

const ACTIVITY = [
  ["2m", "Argo CD", "Portfolio applications reconciled", "ok"],
  ["8m", "Longhorn", "Replica health check completed", "ok"],
  ["21m", "AI Lab", "Evaluation run archived", "info"],
  ["46m", "Cyberlab", "Scenario workspace cleaned", "info"],
] as const;

export default function Dashboard() {
  const [stats, setStats] = useState<{ users?: number; roles?: number }>({});

  useEffect(() => {
    listUsers()
      .then((users) =>
        setStats((current) => ({ ...current, users: users.length })),
      )
      .catch(() => {});
    listRoles()
      .then((roles) =>
        setStats((current) => ({ ...current, roles: roles.length })),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <PageHead
        kicker="Network command"
        title="Everything you run, in one place."
        sub="Operate the cluster, labs, delivery pipeline, and identity layer from one private control surface."
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Platform"
          value="Healthy"
          detail="all gateways responding"
          tone="ok"
        />
        <Metric
          label="Kubernetes"
          value="3 / 3"
          detail="nodes ready"
          tone="ok"
        />
        <Metric
          label="Workloads"
          value="41"
          detail="pods across 8 namespaces"
        />
        <Metric
          label="Users"
          value={stats.users ?? "—"}
          detail={`${stats.roles ?? "—"} roles defined`}
        />
        <Metric
          label="Delivery drift"
          value="0"
          detail="desired state matches"
          tone="ok"
        />
      </section>

      <section className="mb-6">
        <SectionTitle title="Control surfaces" meta="4 managed systems" />
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {SYSTEMS.map((system) => (
            <article
              key={system.name}
              className="group relative overflow-hidden rounded-2xl border border-line bg-panel/62 p-5 backdrop-blur-xl transition-colors hover:border-[color-mix(in_srgb,var(--tone)_45%,var(--line))]"
              style={{ "--tone": system.tone } as CSSProperties}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--tone)] to-transparent opacity-60" />
              <div className="flex items-center justify-between gap-3">
                <span className="size-2 rounded-full bg-[var(--tone)] shadow-[0_0_12px_var(--tone)]" />
                <span className="font-mono text-[9px] tracking-[0.1em] text-ink-dim uppercase">
                  {system.status}
                </span>
              </div>
              <h2 className="mt-8 text-[17px] font-semibold text-ink">
                {system.name}
              </h2>
              <p className="mt-1 min-h-10 text-[12px] leading-relaxed text-ink-mid">
                {system.description}
              </p>
              <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
                <strong className="font-mono text-[12px] text-[var(--tone)]">
                  {system.metric}
                </strong>
                <div className="flex gap-2">
                  <a
                    href={system.publicHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md px-2 py-1 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
                  >
                    Open ↗
                  </a>
                  <Link
                    href={system.href}
                    className="rounded-md bg-[var(--tone)] px-2.5 py-1 text-[10px] font-bold text-[#090a0d]"
                  >
                    Manage
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-2xl border border-line bg-panel/58 backdrop-blur-xl">
          <div className="border-b border-line p-5">
            <SectionTitle
              title="Kubernetes estate"
              meta="live connector boundary"
              compact
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="font-mono text-[9px] tracking-[0.11em] text-ink-dim uppercase">
                  <th className="px-5 py-3 font-medium">Node</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">CPU</th>
                  <th className="px-4 py-3 font-medium">Memory</th>
                  <th className="px-5 py-3 text-right font-medium">Pods</th>
                </tr>
              </thead>
              <tbody>
                {NODES.map((node) => (
                  <tr
                    key={node.name}
                    className="border-t border-line text-[12px]"
                  >
                    <td className="px-5 py-4 font-mono font-semibold text-ink">
                      {node.name}
                    </td>
                    <td className="px-4 py-4 text-ink-mid">{node.role}</td>
                    <td className="px-4 py-4">
                      <Usage value={node.cpu} />
                    </td>
                    <td className="px-4 py-4">
                      <Usage value={node.memory} />
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-ink-mid">
                      {node.pods}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            {[
              "Open Grafana",
              "Inspect workloads",
              "Storage health",
              "Network policies",
            ].map((action) => (
              <Link
                key={action}
                href="/servers"
                className="rounded-lg border border-line bg-panel-2/45 px-3 py-2 text-[11px] font-semibold text-ink-mid hover:border-line-soft hover:text-ink"
              >
                {action}
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-panel/58 p-5 backdrop-blur-xl">
          <SectionTitle title="Operations feed" meta="most recent" compact />
          <div className="mt-5 flex flex-col gap-1">
            {ACTIVITY.map(([time, source, event, tone]) => (
              <article
                key={`${time}-${source}`}
                className="grid grid-cols-[34px_8px_1fr] gap-3 rounded-lg px-2 py-3 hover:bg-panel-2/45"
              >
                <time className="font-mono text-[9px] text-ink-dim">
                  {time}
                </time>
                <i
                  className={`mt-1 size-1.5 rounded-full ${tone === "ok" ? "bg-ok" : "bg-accent"}`}
                />
                <div>
                  <div className="font-mono text-[9px] tracking-[0.08em] text-ink-dim uppercase">
                    {source}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-mid">{event}</p>
                </div>
              </article>
            ))}
          </div>
          <Link
            href="/projects"
            className="mt-4 inline-flex text-[11px] font-semibold text-accent-bright hover:text-ink"
          >
            View delivery history →
          </Link>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "ok";
}) {
  return (
    <article className="rounded-xl border border-line bg-panel/58 p-4 backdrop-blur-xl">
      <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.12em] text-ink-dim uppercase">
        {label}
        {tone && (
          <i className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
        )}
      </div>
      <strong className="mt-3 block text-2xl tracking-[-0.04em] text-ink">
        {value}
      </strong>
      <span className="mt-1 block text-[10px] text-ink-dim">{detail}</span>
    </article>
  );
}

function SectionTitle({
  title,
  meta,
  compact = false,
}: {
  title: string;
  meta: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-end justify-between gap-4 ${compact ? "" : "mb-3"}`}
    >
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <span className="font-mono text-[8px] tracking-[0.1em] text-ink-dim uppercase">
        {meta}
      </span>
    </div>
  );
}

function Usage({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-2">
        <i
          className="block h-full rounded-full bg-accent"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-ink-dim">{value}%</span>
    </div>
  );
}
