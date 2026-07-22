"use client";

import { useEffect, useState } from "react";
import {
  devLogin,
  getMe,
  getProviders,
  logout,
  providerLoginUrl,
  safeReturn,
  type AuthProviders,
  type SessionUser,
} from "@iw/core";

const GLYPH: Record<string, React.ReactNode> = {
  Google: (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.38Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1.03 7.6-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.88 1.1-2.98 0-5.5-2.01-6.4-4.71H1.76v2.98A11.5 11.5 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.6 14.71a6.9 6.9 0 0 1 0-4.42V7.31H1.76a11.5 11.5 0 0 0 0 10.38l3.84-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.68 0 3.19.58 4.38 1.72l3.29-3.29A11.5 11.5 0 0 0 1.76 7.31L5.6 10.3C6.5 7.58 9.02 4.77 12 4.77Z"
      />
    </svg>
  ),
  GitHub: (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      aria-hidden
      fill="currentColor"
    >
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.46-2.3 1.2-3.1-.12-.3-.52-1.48.11-3.08 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.6.23 2.78.11 3.08.75.8 1.2 1.84 1.2 3.1 0 4.43-2.7 5.4-5.28 5.69.42.36.79 1.08.79 2.17v3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  ),
};

export default function LoginPanel({ returnTo }: { returnTo: string }) {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const [devEmail, setDevEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dest = safeReturn(returnTo);

  useEffect(() => {
    let alive = true;
    getMe().then((u) => alive && setMe(u));
    getProviders()
      .then(setProviders)
      .catch(() => setError("Couldn't reach the identity service."));
    return () => {
      alive = false;
    };
  }, []);

  const doDevLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await devLogin(devEmail);
      window.location.href = dest;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  // Already signed in: this page is a turnstile, so offer the way through — not a form.
  if (me) {
    return (
      <div className="pop-in w-full max-w-md rounded-xl border border-line bg-[color-mix(in_srgb,var(--card)_86%,transparent)] p-7 text-center shadow-(--shadow-3) backdrop-blur-md">
        <span
          aria-hidden
          className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-[linear-gradient(135deg,var(--accent),#8b5cf6)] text-xl font-bold text-white"
        >
          {(me.displayName || me.email || "?").charAt(0).toUpperCase()}
        </span>
        <h1 className="font-display text-xl font-bold">
          You&apos;re signed in
        </h1>
        <p className="mt-1 truncate font-mono text-xs text-ink-dim">
          {me.email}
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          <a
            href={dest}
            className="inline-flex h-(--ctl-lg) items-center justify-center rounded-md bg-accent text-[15px] font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Continue
          </a>
          <button
            onClick={async () => {
              await logout();
              setMe(null);
            }}
            className="h-(--ctl-lg) cursor-pointer rounded-md border border-line text-[15px] font-semibold text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Sign out
          </button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-ink-dim">
          Profile, sessions, and preferences live in the Settings menu on every
          site — this page only handles signing in and out.
        </p>
      </div>
    );
  }

  return (
    <div className="pop-in w-full max-w-md rounded-xl border border-line bg-[color-mix(in_srgb,var(--card)_86%,transparent)] p-7 shadow-(--shadow-3) backdrop-blur-md">
      <h1 className="font-display text-2xl font-bold tracking-[-0.01em]">
        Sign in
      </h1>
      <p className="mt-1.5 mb-6 text-sm leading-relaxed text-ink-mid">
        One account for the whole network. New here? Signing in with a provider
        creates your account.
      </p>

      <div className="flex flex-col gap-3">
        {providers?.providers.map((p) => (
          <a
            key={p}
            href={providerLoginUrl(p, dest)}
            className="group inline-flex h-(--ctl-lg) items-center justify-center gap-2.5 rounded-md border border-line bg-surface-2 px-4 text-[15px] font-semibold text-ink transition-[border-color,background-color,transform] duration-(--dur-fast) outline-none hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))] hover:bg-card focus-visible:ring-2 focus-visible:ring-accent/50 active:translate-y-px"
          >
            {GLYPH[p]}
            Continue with {p}
          </a>
        ))}

        {providers &&
          providers.providers.length === 0 &&
          !providers.devLogin && (
            <p className="text-sm text-ink-mid">
              No sign-in providers are configured yet.
            </p>
          )}
      </div>

      {providers?.devLogin && (
        <>
          {providers.providers.length > 0 && (
            <div className="my-5 flex items-center gap-3 font-mono text-[10px] tracking-[0.18em] text-ink-dim uppercase">
              <span className="h-px flex-1 bg-line" />
              dev only
              <span className="h-px flex-1 bg-line" />
            </div>
          )}
          <form onSubmit={doDevLogin} className="flex flex-col gap-3">
            <input
              className="h-(--ctl-lg) w-full rounded-md border border-line bg-surface-2 px-3.5 text-[15px] text-ink transition-[border-color] duration-(--dur-fast) outline-none placeholder:text-ink-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              type="email"
              required
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              placeholder="you@example.com (dev login)"
              autoComplete="email"
              aria-label="Dev login email"
            />
            <button
              type="submit"
              disabled={busy}
              className="h-(--ctl-lg) cursor-pointer rounded-md bg-accent text-[15px] font-semibold text-white transition-[opacity,transform] duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:opacity-50"
            >
              {busy ? "One moment…" : "Dev sign in"}
            </button>
          </form>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-dim">
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        No password stored — identity comes from your provider.
      </p>
    </div>
  );
}
