"use client";

// A labelled range control that commits once, on release.
//
// The distinction matters whenever the value drives real work. A native range input fires `change`
// on every notch it passes, so dragging 1 → 6 sends five values, four of which nobody asked for.
// Here the thumb follows the pointer locally and the committed value is reported only when the drag
// ends — press, drag, release. Keyboard use commits on key release, so arrow-stepping is one commit
// per press rather than one per repeat.
//
// Presentation only: value in, committed value out. Styling rides the design-contract tokens
// (ink / ink-dim / line / brand / surface), so it wears each app's palette without knowing which
// app it is in.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Thumb and filled-track live in real CSS because ::-webkit-slider-thumb has no utility-class
// equivalent. Emitted with the component so a consuming app needs no stylesheet of its own; the
// rules are identical in every copy, so duplicates cost nothing.
const THUMB_CSS = `
.iw-range{background:linear-gradient(to right,var(--brand) var(--iw-range-fill),var(--line) var(--iw-range-fill));}
.iw-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;
background:var(--brand);border:2px solid var(--surface,var(--base,#000));cursor:pointer;
transition:transform .12s cubic-bezier(.2,.8,.2,1),box-shadow .12s;}
.iw-range::-webkit-slider-thumb:hover{transform:scale(1.15);}
.iw-range:active::-webkit-slider-thumb{transform:scale(1.25);box-shadow:0 0 0 6px color-mix(in srgb,var(--brand) 18%,transparent);}
.iw-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 30%,transparent);}
.iw-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--brand);
border:2px solid var(--surface,var(--base,#000));cursor:pointer;}
@media (prefers-reduced-motion:reduce){.iw-range::-webkit-slider-thumb{transition:none;}}
`;

export function RangeSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
  format,
  hint,
  ticks = false,
  pending = false,
  disabled = false,
  id,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Called once, with the final value, when the drag or keypress ends. */
  onCommit: (value: number) => void;
  /** Renders the current value beside the label. Defaults to the bare number. */
  format?: (value: number) => string;
  hint?: ReactNode;
  /** Show the discrete stops under the track. Only sensible for small integer ranges. */
  ticks?: boolean;
  /** Something is in flight for this control; shown as a pulse next to the value. */
  pending?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);

  // Track the source of truth, but never yank the thumb out from under a finger mid-drag.
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);

  const commit = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    setLocal((current) => {
      if (current !== value) onCommit(current);
      return current;
    });
  }, [onCommit, value]);

  // A pointer can be released outside the input (or off the window entirely) and the input would
  // never hear about it, stranding the drag. Watch the document for as long as one is in progress.
  useEffect(() => {
    if (disabled) return;
    const end = () => commit();
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    return () => {
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };
  }, [commit, disabled]);

  const pct = max === min ? 0 : ((local - min) / (max - min)) * 100;
  const stops = ticks
    ? Array.from(
        { length: Math.floor((max - min) / step) + 1 },
        (_, i) => min + i * step,
      )
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <style>{THUMB_CSS}</style>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-ink"
      >
        <span>{label}</span>
        <b className="inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-brand">
          {pending && (
            <i
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-brand"
            />
          )}
          {format ? format(local) : local}
        </b>
      </label>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        className="iw-range h-1 w-full cursor-pointer appearance-none rounded-full bg-line outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ ["--iw-range-fill" as string]: `${pct}%` }}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onChange={(e) => {
          // Keyboard interaction never fires pointerdown, so treat any change as a live drag; the
          // matching keyup (or the document pointerup) is what ends it.
          dragging.current = true;
          setLocal(Number(e.target.value));
        }}
        onKeyUp={commit}
        onBlur={commit}
      />

      {ticks && (
        <div className="flex justify-between text-[9.5px] tabular-nums text-ink-dim">
          {stops.map((n) => (
            <span
              key={n}
              className={n === local ? "font-semibold text-brand" : ""}
            >
              {n}
            </span>
          ))}
        </div>
      )}

      {hint && (
        <small className="text-[11px] leading-snug text-ink-dim">{hint}</small>
      )}
    </div>
  );
}
