import Link from "next/link";

// Themed 404 in the ops-console voice.
export default function NotFound() {
  return (
    <section className="shell grid min-h-[60vh] place-items-center py-16 text-center">
      <div className="rise-in">
        <div className="font-mono text-[11px] font-bold tracking-[0.28em] text-attacker uppercase">
          404 · signal lost
        </div>
        <h1 className="mt-4 text-[clamp(22px,3.2vw,32px)] font-bold tracking-[-0.01em]">
          No such route on this range
        </h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15px] text-ink-mid">
          Whatever you were tracing doesn&apos;t resolve here. The scenarios and
          the live view are still up.
        </p>
        <div className="mx-auto mt-5 w-fit rounded-md border border-line-soft bg-panel px-4 py-2 text-left font-mono text-[12px] text-ink-dim">
          <span className="text-responder">$</span> curl -I /this-page{"  "}
          <span className="text-attacker">→ 404</span>
        </div>
        <div className="mt-7 flex justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-(--ctl-lg) items-center rounded-md border border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_22%,var(--panel-2))] px-5 text-[15px] font-semibold text-[color-mix(in_srgb,var(--accent)_92%,#fff)] transition-colors duration-(--dur-fast) outline-none hover:bg-[color-mix(in_srgb,var(--accent)_32%,var(--panel-2))] focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Overview
          </Link>
          <Link
            href="/scenarios"
            className="inline-flex h-(--ctl-lg) items-center rounded-md border border-line bg-panel-2 px-5 text-[15px] font-semibold text-ink transition-colors duration-(--dur-fast) outline-none hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Case studies
          </Link>
        </div>
      </div>
    </section>
  );
}
