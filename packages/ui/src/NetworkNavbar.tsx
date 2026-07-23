import type { CSSProperties, ReactNode } from "react";
import { PORTFOLIO_SITES, type PortfolioSiteId } from "@iw/core";
import {
  BrainCircuit,
  Network,
  ServerCog,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { NetworkControls } from "./NetworkControls";

export interface NetworkNavLink {
  href: string;
  label: string;
}

const SITE_IDENTITY: Record<
  PortfolioSiteId,
  { accent: string; rest: string; icon: LucideIcon }
> = {
  main: { accent: "", rest: "Isaac Wallace", icon: Network },
  cyberlab: { accent: "Sec", rest: "Ops", icon: ShieldCheck },
  homelab: { accent: "Home", rest: "Ops", icon: ServerCog },
  ailab: { accent: "AI", rest: "Ops", icon: BrainCircuit },
};

export function NetworkNavbar({
  current,
  homeHref = "/",
  links = [],
  siteTab,
}: {
  current: PortfolioSiteId;
  homeHref?: string;
  links?: readonly NetworkNavLink[];
  siteTab?: ReactNode;
}) {
  const site = PORTFOLIO_SITES.find((candidate) => candidate.id === current)!;
  const identity = SITE_IDENTITY[current];
  const SiteIcon = identity.icon;
  const style = { "--network-accent": site.color } as CSSProperties;

  return (
    <header
      className="sticky top-0 z-40 border-b border-line bg-surface/88 backdrop-blur-xl"
      style={style}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-4 px-[clamp(14px,2.4vw,32px)]">
        <a
          href={homeHref}
          aria-label={`${site.name} home`}
          className="group flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <span className="grid size-8 place-items-center rounded-[9px] border border-[color-mix(in_srgb,var(--network-accent)_48%,var(--line))] bg-[color-mix(in_srgb,var(--network-accent)_14%,var(--surface))] text-[var(--network-accent)] shadow-[0_0_18px_color-mix(in_srgb,var(--network-accent)_10%,transparent)] transition-colors duration-(--dur-fast) group-hover:bg-[color-mix(in_srgb,var(--network-accent)_22%,var(--surface))]">
            <SiteIcon aria-hidden className="size-4" strokeWidth={2.1} />
          </span>
          <strong className="truncate text-[14px] font-bold tracking-[0.01em] text-ink">
            {identity.accent && (
              <span className="text-[var(--network-accent)]">
                {identity.accent}
              </span>
            )}
            {identity.rest}
          </strong>
        </a>

        {links.length > 0 && (
          <nav
            aria-label={`${site.name} navigation`}
            className="ml-5 hidden items-center gap-6 text-[12px] text-ink-mid lg:flex"
          >
            {links.map((link) => (
              <a
                key={`${link.href}-${link.label}`}
                href={link.href}
                className="rounded-md transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}

        <NetworkControls current={current} siteTab={siteTab} />
      </div>
    </header>
  );
}
