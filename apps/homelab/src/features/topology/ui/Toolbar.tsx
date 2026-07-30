"use client";

import { Search, X } from "lucide-react";
import { LAYERS } from "../model/layers";
import s from "../topology.module.css";

interface Props {
  live: boolean;
  query: string;
  onQuery: (value: string) => void;
  layer: string;
  onLayer: (value: string) => void;
  /** How many boxes survived the current filter, out of the whole inventory. */
  shown: number;
  total: number;
}

export function Toolbar({
  live,
  query,
  onQuery,
  layer,
  onLayer,
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
          placeholder="Filter components…"
          aria-label="Filter components"
          onChange={(e) => onQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear filter"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className={s.layerPills} role="group" aria-label="Filter by layer">
        <button
          type="button"
          data-active={layer === "all" || undefined}
          onClick={() => onLayer("all")}
        >
          All
        </button>
        {LAYERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            data-layer={id}
            data-active={layer === id || undefined}
            onClick={() => onLayer(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <span className={s.count}>
        {shown === total ? `${total} components` : `${shown} of ${total}`}
      </span>
    </div>
  );
}
