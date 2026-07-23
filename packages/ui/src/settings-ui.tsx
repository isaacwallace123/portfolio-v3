"use client";

// Shared, token-driven building blocks for the settings surface. Pure presentation — value in,
// change out — so both the account modal (@iw/ui) and each app's per-site cosmetic panel compose
// the *same* controls and they wear each app's palette via the design-contract tokens
// (surface / ink / brand / line). No storage or side effects live here.

import type { ReactNode } from "react";

/* ── Section header: a titled band opening a group of rows ─────────────────── */

export function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">
          {description}
        </p>
      )}
    </div>
  );
}

/* ── Row: a labelled setting with its control on the right ─────────────────── */

export function SettingRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2/48 px-3.5 py-3 backdrop-blur-md">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {title}
        </label>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ── Toggle: an accessible on/off switch ──────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-(--dur-base) outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
        checked ? "bg-brand" : "bg-line"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-(--shadow-1) transition-transform duration-(--dur-base) ease-(--ease-spring) ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

/* ── Segmented control: a small set of mutually-exclusive choices ──────────── */

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-lg border border-line bg-surface-2/42 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`h-7 cursor-pointer rounded-md px-2.5 text-[13px] font-semibold transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
              active
                ? "bg-brand text-white shadow-(--shadow-1)"
                : "text-ink-mid hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
