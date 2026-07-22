"use client";

// A compact accent picker: a "site default" reset plus curated colour swatches, and a small live
// preview of a button + link in the chosen colour. No colour wheel — just the presets, the way a
// theme switcher shows you what you'll get. Token-driven chrome so it wears each app's palette.

export type AccentSwatch = { name: string; hex: string };

const Check = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="3.5"
    aria-hidden
  >
    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function AccentPicker({
  value,
  onChange,
  swatches,
}: {
  /** null = follow the site's own accent. */
  value: string | null;
  onChange: (hex: string | null) => void;
  swatches: AccentSwatch[];
}) {
  const dot =
    "grid size-8 cursor-pointer place-items-center rounded-full text-white outline-none transition-transform duration-(--dur-fast) hover:scale-110 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

  return (
    <div
      role="radiogroup"
      aria-label="Accent colour"
      className="flex flex-wrap items-center gap-2.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="Site default"
        title="Site default"
        onClick={() => onChange(null)}
        className={`${dot} border border-line bg-surface-2 text-ink-dim focus-visible:ring-brand ${
          value === null
            ? "ring-2 ring-brand ring-offset-2 ring-offset-surface"
            : ""
        }`}
      >
        {value === null ? (
          <span className="text-ink">
            <Check />
          </span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path
              d="M4 12a8 8 0 1 1 2.3 5.6M4 12V7m0 5h5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {swatches.map((s) => {
        const active = s.hex.toLowerCase() === (value ?? "").toLowerCase();
        return (
          <button
            key={s.hex}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={s.name}
            title={s.name}
            onClick={() => onChange(s.hex)}
            style={{
              background: s.hex,
              boxShadow: active
                ? `0 0 0 2px var(--surface), 0 0 0 4px ${s.hex}`
                : undefined,
            }}
            className={`${dot} focus-visible:ring-[color:currentColor]`}
          >
            {active && <Check />}
          </button>
        );
      })}
    </div>
  );
}
