"use client";

import { Search, Spline, X } from "lucide-react";
import s from "../topology.module.css";

interface Props {
  live: boolean;
  query: string;
  onQuery: (value: string) => void;
  /** Draw every component link at once instead of only the one being pointed at. */
  showAllLinks: boolean;
  onToggleLinks: () => void;
  shown: number;
  total: number;
}

export function Toolbar({
  live,
  query,
  onQuery,
  showAllLinks,
  onToggleLinks,
  shown,
  total,
}: Props) {
  return (
    <div className={s.toolbar}>
      <span className={s.liveTag}>
        <i className={s.liveDot} data-live={live || undefined} />
        {live ? "LIVE INVENTORY" : "CONNECTING"}
      </span>

      <div className={s.search}>
        <Search size={13} />
        <input
          type="search"
          value={query}
          placeholder="Find a component…"
          aria-label="Find a component"
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Off by default: thirty-eight links drawn at once is the mess this arrangement avoids, but
          being able to see the whole web at once is worth one button. */}
      <button
        type="button"
        className={s.linkToggle}
        data-active={showAllLinks || undefined}
        aria-pressed={showAllLinks}
        onClick={onToggleLinks}
      >
        <Spline size={12} /> All connections
      </button>

      <span className={s.count}>
        {shown === total ? `${total} components` : `${shown} of ${total}`}
      </span>
    </div>
  );
}
