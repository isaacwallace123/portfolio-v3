"use client";

import { useEffect } from "react";
import Link from "next/link";

// Route error boundary for the control plane.
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
    <section className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div className="w-full max-w-md rounded-xl border border-danger/40 bg-panel p-6">
        <div className="kicker text-danger">panel fault</div>
        <h1 className="mt-3 text-xl font-bold tracking-[-0.01em]">
          This panel crashed
        </h1>
        <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-ink-mid">
          Contained to this view — the API and your admin session are fine.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-ink-dim">
            ref {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2.5">
          <button
            onClick={reset}
            className="inline-flex h-10 cursor-pointer items-center rounded-md bg-accent px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-md border border-line bg-panel-2 px-5 text-sm font-semibold text-ink transition-colors hover:border-line-soft"
          >
            Console home
          </Link>
        </div>
      </div>
    </section>
  );
}
