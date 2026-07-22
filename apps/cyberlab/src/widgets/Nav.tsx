"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import UserMenu from "@/widgets/UserMenu";
import { cn } from "@/shared/lib/utils";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/scenarios", label: "Case studies" },
] as const;

export default function Nav() {
  const path = usePathname();
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  return (
    <nav className="sticky top-0 z-40 border-b border-line-soft bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-md">
      <div className="shell flex h-16 items-center gap-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md font-bold tracking-[0.01em] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span
            aria-hidden
            className="size-2.5 rounded-full bg-primary shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)]"
          />
          cyberlab
          <small className="font-mono text-[10px] font-bold tracking-[0.24em] text-ink-dim uppercase">
            cyber range
          </small>
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "relative rounded-md px-3 py-2 text-sm transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                "after:absolute after:inset-x-3 after:-bottom-px after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-(--dur-base) after:ease-(--ease-out)",
                isActive(l.href)
                  ? "text-ink after:scale-x-100"
                  : "text-ink-mid hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/live"
            className={cn(
              "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              "border-[color-mix(in_srgb,var(--attacker)_45%,var(--line))] text-[color-mix(in_srgb,var(--attacker)_90%,#fff)]",
              isActive("/live")
                ? "bg-[color-mix(in_srgb,var(--attacker)_14%,transparent)]"
                : "hover:bg-[color-mix(in_srgb,var(--attacker)_10%,transparent)]",
            )}
          >
            <span
              aria-hidden
              className="size-[7px] animate-blip rounded-full bg-attacker"
            />
            Live
          </Link>
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
