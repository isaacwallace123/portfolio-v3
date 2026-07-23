import type { CSSProperties } from "react";
import { PORTFOLIO_SITES, type PortfolioSiteId } from "@iw/core";

export function NetworkFooter({ current }: { current: PortfolioSiteId }) {
  const active = PORTFOLIO_SITES.find((site) => site.id === current)!;
  const style = { "--network-accent": active.color } as CSSProperties;

  return (
    <footer
      className="mt-auto border-t border-line bg-surface/30"
      style={style}
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-[clamp(18px,2.4vw,32px)] py-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-[color-mix(in_srgb,var(--network-accent)_40%,var(--line))] bg-[color-mix(in_srgb,var(--network-accent)_9%,var(--surface))] font-mono text-[9px] font-black text-[var(--network-accent)]">
            IW
          </span>
          <span className="min-w-0">
            <strong className="block text-[12px] font-semibold tracking-[0.01em] text-ink">
              Isaac Wallace
            </strong>
            <span className="block text-[10px] text-ink-dim">
              One network. Four working systems.
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <nav aria-label="Portfolio network" className="flex flex-wrap gap-4">
            {PORTFOLIO_SITES.map((site) => (
              <a
                key={site.id}
                href={site.href}
                aria-current={site.id === current ? "page" : undefined}
                className="font-mono text-[9px] font-bold tracking-[0.11em] text-ink-dim uppercase transition-colors hover:text-ink aria-[current=page]:text-[var(--network-accent)]"
              >
                {site.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[8px] tracking-[0.09em] text-ink-dim uppercase">
            <span>© {new Date().getFullYear()} Isaac Wallace</span>
            <span aria-hidden>·</span>
            <a
              href="https://github.com/isaacwallace123"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-ink"
            >
              GitHub
            </a>
            <span aria-hidden>·</span>
            <a
              href="https://www.linkedin.com/in/isaac-wallace/"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-ink"
            >
              LinkedIn
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
