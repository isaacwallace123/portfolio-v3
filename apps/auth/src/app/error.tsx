"use client";

import { useEffect } from "react";
import Link from "next/link";

// Route error boundary — same card language as the login panel, nothing scary.
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
    <div className="pop-in w-full max-w-md rounded-xl border border-line bg-[color-mix(in_srgb,var(--card)_86%,transparent)] p-7 text-center shadow-(--shadow-3) backdrop-blur-md">
      <div className="font-mono text-[11px] font-bold tracking-[0.24em] text-danger uppercase">
        something broke
      </div>
      <h1 className="mt-3 text-xl font-bold tracking-[-0.01em]">
        The identity portal hit an error
      </h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-mid">
        Your session and account are fine — this is a page error, not an auth
        one. Try again; if it keeps happening, come back later.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[11px] text-ink-dim">
          ref {error.digest}
        </p>
      )}
      <div className="mt-6 flex justify-center gap-2.5">
        <button
          onClick={reset}
          className="inline-flex h-(--ctl-lg) cursor-pointer items-center justify-center rounded-md bg-accent px-6 text-[15px] font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Try again
        </button>
        <Link
          href="/login"
          className="inline-flex h-(--ctl-lg) items-center justify-center rounded-md border border-line px-6 text-[15px] font-semibold text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Sign-in page
        </Link>
      </div>
    </div>
  );
}
