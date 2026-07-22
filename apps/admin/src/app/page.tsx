"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listRoles, listUsers } from "@/shared/api/adminApi";
import PageHead from "@/shared/ui/PageHead";

const SITES = [
  {
    name: "isaacwallace.dev",
    role: "Main portfolio",
    href: "https://isaacwallace.dev",
    tone: "#3b5bdb",
  },
  {
    name: "cyberlab",
    role: "Cyber range",
    href: "https://cyberlab.isaacwallace.dev",
    tone: "#45c9dd",
  },
  {
    name: "homelab",
    role: "DevOps / k3s",
    href: "https://homelab.isaacwallace.dev",
    tone: "#34d399",
  },
  {
    name: "ailab",
    role: "AI lab",
    href: "https://ailab.isaacwallace.dev",
    tone: "#b79cff",
  },
];

export default function Dashboard() {
  const [stats, setStats] = useState<{ users?: number; roles?: number }>({});

  useEffect(() => {
    listUsers()
      .then((u) => setStats((s) => ({ ...s, users: u.length })))
      .catch(() => {});
    listRoles()
      .then((r) => setStats((s) => ({ ...s, roles: r.length })))
      .catch(() => {});
  }, []);

  return (
    <>
      <PageHead
        kicker="Overview"
        title="Control plane"
        sub="One place to manage the whole network — access today, servers, projects, cyberlab, and AI as they come online."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={stats.users} href="/users" />
        <Stat label="Roles" value={stats.roles} href="/roles" />
        <Stat label="Sites" value={SITES.length} />
        <Stat
          label="Passwords stored"
          value={0}
          hint="auth is delegated — nothing to breach"
        />
      </div>

      <div className="kicker mb-3">Network</div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SITES.map((s) => (
          <a
            key={s.name}
            href={s.href}
            className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-4 transition-colors outline-none hover:border-line-soft focus-visible:ring-2 focus-visible:ring-accent/50"
            style={{ ["--tone" as string]: s.tone }}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-[3px]"
              style={{ background: "var(--tone)" }}
            />
            <div className="min-w-0">
              <div className="truncate font-mono text-sm text-ink">
                {s.name}
              </div>
              <div className="truncate text-xs text-ink-dim">{s.role}</div>
            </div>
            <span className="ml-auto text-sm text-ink-dim opacity-0 transition-opacity group-hover:opacity-100">
              ↗
            </span>
          </a>
        ))}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value?: number;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className="kicker">{label}</div>
      <div className="mt-2 text-3xl font-bold tabular-nums">{value ?? "—"}</div>
      {hint && <div className="mt-1 text-[11px] text-ink-dim">{hint}</div>}
    </>
  );
  const cls =
    "rounded-xl border border-line bg-panel p-5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
  return href ? (
    <Link href={href} className={`${cls} block hover:border-line-soft`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
