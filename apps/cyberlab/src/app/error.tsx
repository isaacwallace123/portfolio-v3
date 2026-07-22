"use client";

import { useEffect } from "react";
import Link from "next/link";

// Route error boundary in the ops-console voice: an incident card, not a crash page.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="shell grid min-h-[60vh] place-items-center py-16">
      <div className="rise-in w-full max-w-md rounded-lg border border-[color-mix(in_srgb,var(--attacker)_40%,var(--line))] bg-panel p-6 text-center shadow-(--shadow-2)">
        <div className="inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.24em] text-attacker uppercase">
          <span
            aria-hidden
            className="size-[7px] animate-blip rounded-full bg-attacker"
          />
          incident · page fault
        </div>
        <h1 className="mt-3 text-xl font-bold tracking-[-0.01em]">
          This view crashed
        </h1>
        <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-ink-mid">
          Contained to this page — the range, the recordings, and your session
          are all fine. Re-run it.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-ink-dim">
            ref {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2.5">
          <button
            onClick={reset}
            className="inline-flex h-(--ctl) cursor-pointer items-center rounded-md border border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_22%,var(--panel-2))] px-5 text-sm font-semibold text-[color-mix(in_srgb,var(--accent)_92%,#fff)] transition-colors duration-(--dur-fast) outline-none hover:bg-[color-mix(in_srgb,var(--accent)_32%,var(--panel-2))] focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-(--ctl) items-center rounded-md border border-line bg-panel-2 px-5 text-sm font-semibold text-ink transition-colors duration-(--dur-fast) outline-none hover:border-[color-mix(in_srgb,var(--accent)_55%,var(--line))] focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Overview
          </Link>
        </div>
      </div>
    </section>
  );
}
