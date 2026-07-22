"use client";

import { useEffect } from "react";
import Link from "next/link";

// Route error boundary — editorial and calm, with a way back.
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
    <section className="shell grid min-h-[60vh] place-items-center py-16 text-center">
      <div className="rise-in">
        <div className="eyebrow text-[#c23b3b]">something broke</div>
        <h1 className="mt-4 font-display text-(length:--fs-h1) font-bold tracking-[-0.01em]">
          The page tripped over itself
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-[15px] text-ink-mid">
          An error stopped this page from rendering. The rest of the network is
          unaffected — try again, or head back home.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-ink-dim">
            ref {error.digest}
          </p>
        )}
        <div className="mt-7 flex justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex h-(--ctl-lg) cursor-pointer items-center rounded-md bg-ink px-5 text-[15px] font-semibold text-paper transition-opacity duration-(--dur-fast) outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-(--ctl-lg) items-center rounded-md border border-line bg-card px-5 text-[15px] font-semibold text-ink transition-colors duration-(--dur-fast) outline-none hover:border-line-2 hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Back home
          </Link>
        </div>
      </div>
    </section>
  );
}
