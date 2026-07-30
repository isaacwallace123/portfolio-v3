"use client";

import { ChevronsDownUp, Search, X } from "lucide-react";
import { LAYERS } from "../model/layers";
import s from "../topology.module.css";

interface Props {
  live: boolean;
  query: string;
  onQuery: (value: string) => void;
  /** Layers currently drawn as their individual components. */
  expanded: ReadonlySet<string>;
  onToggleLayer: (layer: string) => void;
  onCollapseAll: () => void;
  /** Layers with more than one component — the rest have nothing to collapse. */
  collapsible: readonly string[];
  /** Boxes currently drawn, against the size of the whole inventory. */
  shown: number;
  total: number;
}

export function Toolbar({
  live,
  query,
  onQuery,
  expanded,
  onToggleLayer,
  onCollapseAll,
  collapsible,
  shown,
  total,
}: Props) {
  const anyExpanded = expanded.size > 0;

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

      {/* These open and close layers rather than filtering them away: the shape of the system is the
          point of the page, so nothing is ever hidden — only summarised until you ask for it. */}
      <div className={s.layerPills} role="group" aria-label="Expand a layer">
        {LAYERS.filter(({ id }) => collapsible.includes(id)).map(
          ({ id, label }) => (
            <button
              key={id}
              type="button"
              data-layer={id}
              data-active={expanded.has(id) || undefined}
              aria-pressed={expanded.has(id)}
              onClick={() => onToggleLayer(id)}
            >
              {label}
            </button>
          ),
        )}
        <button
          type="button"
          className={s.collapseAll}
          onClick={onCollapseAll}
          disabled={!anyExpanded}
          aria-label="Collapse every layer"
        >
          <ChevronsDownUp size={12} /> Collapse
        </button>
      </div>

      <span className={s.count}>
        {shown} {shown === 1 ? "box" : "boxes"} · {total} components
      </span>
    </div>
  );
}
