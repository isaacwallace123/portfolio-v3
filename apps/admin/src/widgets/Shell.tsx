"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@iw/core";
import { AccountMenu, SettingsModal } from "@iw/ui";

type NavItem = {
  href: string;
  label: string;
  code: string;
};

type NavSection = {
  group: string;
  items: NavItem[];
};

const NAV: NavSection[] = [
  {
    group: "Command",
    items: [{ href: "/", label: "Overview", code: "OV" }],
  },
  {
    group: "Infrastructure",
    items: [
      { href: "/servers", label: "Compute & Kubernetes", code: "K8" },
      { href: "/projects", label: "Delivery & projects", code: "CD" },
    ],
  },
  {
    group: "Labs",
    items: [
      { href: "/cyberlab", label: "Cyber range", code: "CY" },
      { href: "/ai", label: "AI platform", code: "AI" },
    ],
  },
  {
    group: "Identity",
    items: [
      { href: "/users", label: "Users", code: "US" },
      { href: "/roles", label: "Roles", code: "RL" },
    ],
  },
  {
    group: "System",
    items: [{ href: "/settings", label: "Control settings", code: "ST" }],
  },
];

export default function Shell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [currentUser, setCurrentUser] = useState(user);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [here] = useState(() =>
    typeof window === "undefined" ? "" : window.location.href,
  );
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);
  const currentLabel =
    NAV.flatMap((section) => section.items).find((item) => active(item.href))
      ?.label ?? "Control plane";

  return (
    <div className="admin-shell grid min-h-screen grid-cols-1 md:grid-cols-[252px_1fr]">
      <aside className="admin-sidebar hidden min-h-screen flex-col border-r border-line bg-panel/55 backdrop-blur-2xl md:flex">
        <Link
          href="/"
          className="flex h-[72px] items-center gap-3 border-b border-line px-5"
        >
          <span className="grid size-9 place-items-center rounded-[10px] border border-accent/35 bg-accent/10 font-mono text-[10px] font-black text-accent-bright">
            IW
          </span>
          <span>
            <strong className="block text-[13px] tracking-[0.01em] text-ink">
              Control plane
            </strong>
            <small className="block font-mono text-[9px] tracking-[0.14em] text-ink-dim uppercase">
              Personal infrastructure
            </small>
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {NAV.map((section) => (
            <section key={section.group} className="mb-5">
              <div className="px-2.5 pb-2 font-mono text-[9px] font-bold tracking-[0.18em] text-ink-dim uppercase">
                {section.group}
              </div>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active(item.href) ? "page" : undefined}
                    className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-mid transition-colors outline-none hover:bg-panel-2/65 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 aria-[current=page]:bg-accent/12 aria-[current=page]:font-semibold aria-[current=page]:text-accent-bright"
                  >
                    <span className="grid size-7 place-items-center rounded-md border border-line bg-panel-2/55 font-mono text-[8px] font-bold text-ink-dim transition-colors group-aria-[current=page]:border-accent/35 group-aria-[current=page]:text-accent-bright">
                      {item.code}
                    </span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="border-t border-line p-4">
          <div className="rounded-xl border border-line bg-panel-2/45 p-3">
            <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.1em] text-ink-dim uppercase">
              <span>Control fabric</span>
              <span className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
            </div>
            <div className="mt-2 text-[11px] text-ink-mid">
              Auth, lab gateways, and cluster connectors
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 flex h-[72px] items-center gap-4 border-b border-line bg-panel/58 px-4 backdrop-blur-2xl sm:px-6">
          <Link href="/" className="font-semibold text-ink md:hidden">
            Control
          </Link>
          <div className="hidden md:block">
            <div className="font-mono text-[9px] tracking-[0.14em] text-ink-dim uppercase">
              Isaac Wallace / Admin
            </div>
            <div className="mt-0.5 text-[13px] font-semibold text-ink">
              {currentLabel}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-lg border border-line bg-panel-2/45 px-3 py-2 font-mono text-[9px] tracking-[0.1em] text-ink-dim uppercase lg:flex">
              <i className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
              Admin session
            </span>
            <AccountMenu
              user={currentUser}
              here={here}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-panel/40 p-2 md:hidden">
          {NAV.flatMap((section) => section.items).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className="shrink-0 rounded-md px-3 py-1.5 text-[11px] text-ink-mid aria-[current=page]:bg-accent/12 aria-[current=page]:font-semibold aria-[current=page]:text-accent-bright"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal
          user={currentUser}
          onUser={setCurrentUser}
          onClose={() => setSettingsOpen(false)}
          initialTab="profile"
        />
      )}
    </div>
  );
}
