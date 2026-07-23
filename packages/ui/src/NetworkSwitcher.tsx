"use client";

import { useEffect, useRef, useState } from "react";
import { PORTFOLIO_SITES, type PortfolioSiteId } from "@iw/core";

export function NetworkSwitcher({ current }: { current: PortfolioSiteId }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const active = PORTFOLIO_SITES.find((site) => site.id === current)!;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Switch portfolio site"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink outline-none transition-colors duration-(--dur-fast) hover:border-line-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{
            background: active.color,
            boxShadow: `0 0 10px ${active.color}`,
          }}
        />
        <span className="hidden sm:inline">{active.label}</span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`size-3 text-ink-dim transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="pop-in absolute right-0 z-50 mt-2 w-72 origin-top-right overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-(--shadow-3)"
        >
          <div className="px-3 py-2 font-mono text-[9px] font-bold tracking-[0.16em] text-ink-dim uppercase">
            Switch site
          </div>
          {PORTFOLIO_SITES.map((site) => (
            <a
              key={site.id}
              href={site.href}
              role="menuitem"
              aria-current={site.id === current ? "page" : undefined}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: site.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  {site.name}
                  {site.id === current && (
                    <small className="font-mono text-[8px] tracking-[0.12em] text-ink-dim uppercase">
                      Current
                    </small>
                  )}
                </span>
                <span className="block truncate text-[11px] text-ink-dim">
                  {site.description}
                </span>
              </span>
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="size-3.5 text-ink-dim transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M7 17 17 7M8 7h9v9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
