"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout, type SessionUser } from "@iw/core";
import { ThemeToggle } from "@iw/ui";

// The navigation mirrors the things the console will manage. "ready" sections work today; "planned"
// sections are real routes with a roadmap placeholder so the shape of the hub is visible now.
const NAV: {
  group: string;
  items: { href: string; label: string; ready?: boolean }[];
}[] = [
  {
    group: "Overview",
    items: [{ href: "/", label: "Dashboard", ready: true }],
  },
  {
    group: "Access",
    items: [
      { href: "/users", label: "Users", ready: true },
      { href: "/roles", label: "Roles", ready: true },
    ],
  },
  {
    group: "Estate",
    items: [
      { href: "/servers", label: "Servers" },
      { href: "/projects", label: "Projects" },
      { href: "/cyberlab", label: "Cyberlab" },
      { href: "/ai", label: "AI" },
    ],
  },
  {
    group: "System",
    items: [{ href: "/settings", label: "Settings" }],
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
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[248px_1fr]">
      <aside className="hidden flex-col border-r border-line bg-panel/60 md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
          <span
            aria-hidden
            className="size-2.5 rounded-[3px] bg-accent shadow-[0_0_12px_var(--accent)]"
          />
          <span className="font-bold tracking-tight">control</span>
          <span className="kicker mt-0.5">admin</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV.map((section) => (
            <div key={section.group} className="mb-5">
              <div className="px-2 pb-1.5 font-mono text-[10px] tracking-[0.18em] text-ink-dim uppercase">
                {section.group}
              </div>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                    active(item.href)
                      ? "bg-accent/12 font-semibold text-accent-bright"
                      : "text-ink-mid hover:bg-panel-2 hover:text-ink",
                  ].join(" ")}
                >
                  {item.label}
                  {!item.ready && (
                    <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-dim uppercase">
                      soon
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3 text-[11px] text-ink-dim">
          isaacwallace.dev · control plane
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-16 items-center gap-4 border-b border-line bg-panel/40 px-5 backdrop-blur-md">
          <span className="font-mono text-xs text-ink-dim md:hidden">
            control · admin
          </span>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <div className="text-right">
              <div className="text-sm leading-tight font-medium">
                {user.displayName}
              </div>
              <div className="font-mono text-[11px] text-ink-dim">
                {user.email}
              </div>
            </div>
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-full bg-accent/15 font-bold text-accent-bright"
            >
              {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
            </span>
            <button
              onClick={() => logout().then(() => window.location.reload())}
              className="h-9 cursor-pointer rounded-md border border-line px-3 text-xs font-semibold text-ink-mid transition-colors hover:border-line-soft hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
