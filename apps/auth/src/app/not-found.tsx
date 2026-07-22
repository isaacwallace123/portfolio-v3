import Link from "next/link";

// Themed 404 — auth only has one real page, so every stray path leads back to it.
export default function NotFound() {
  return (
    <div className="pop-in w-full max-w-md rounded-xl border border-line bg-[color-mix(in_srgb,var(--card)_86%,transparent)] p-7 text-center shadow-(--shadow-3) backdrop-blur-md">
      <div className="font-mono text-[11px] font-bold tracking-[0.24em] text-ink-dim uppercase">
        404 · not found
      </div>
      <h1 className="mt-3 text-xl font-bold tracking-[-0.01em]">
        No such page here
      </h1>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-mid">
        The identity portal has exactly one door — sign in. Everything else
        about your account lives in each site&apos;s Settings menu.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex h-(--ctl-lg) items-center justify-center rounded-md bg-accent px-6 text-[15px] font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        Go to sign in
      </Link>
    </div>
  );
}
