"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  connectProviderUrl,
  deviceLabel,
  disconnectProvider,
  getProviders,
  getSessions,
  loginHref,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
  type ProfilePatch,
  type SessionInfo,
  type SessionUser,
} from "@iw/core";
import { ThemeControl } from "./ThemeControl";
import { NetworkAccessibilitySettings } from "./NetworkAccessibilitySettings";

// The full in-app settings surface, shared across every site. Structure is identical everywhere;
// each app wears its own palette via the design-contract tokens (surface / ink / brand / danger).
// The account tabs (Profile, Security, Sessions) talk to the shared API; Appearance carries the
// network theme and accessibility controls; `siteTab` is an optional extra panel for genuinely
// site-specific prefs. Portaled to <body> because the navbar's
// backdrop-blur is a containing block that would trap position:fixed.

export type SettingsTab =
  "profile" | "appearance" | "site" | "security" | "sessions";

type TabMeta = {
  id: SettingsTab;
  label: string;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  account?: boolean;
};

const I = {
  profile: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  ),
  appearance: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  ),
  site: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M6.5 7h.01M9 7h.01" strokeLinecap="round" />
    </svg>
  ),
  security: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path
        d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
        strokeLinejoin="round"
      />
    </svg>
  ),
  sessions: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </svg>
  ),
};

const TABS: TabMeta[] = [
  {
    id: "profile",
    label: "Profile",
    title: "Profile",
    blurb: "Your shared identity across the network.",
    icon: I.profile,
    account: true,
  },
  {
    id: "appearance",
    label: "Appearance",
    title: "Appearance",
    blurb: "Theme, accent, and how this site looks and moves.",
    icon: I.appearance,
  },
  {
    id: "site",
    label: "This site",
    title: "This site",
    blurb: "Preferences specific to this site — saved in this browser only.",
    icon: I.site,
  },
  {
    id: "security",
    label: "Sign-in & security",
    title: "Sign-in & security",
    blurb: "How you authenticate, and the roles you hold.",
    icon: I.security,
    account: true,
  },
  {
    id: "sessions",
    label: "Sessions",
    title: "Sessions",
    blurb: "Every device signed into your account — revocable network-wide.",
    icon: I.sessions,
    account: true,
  },
];

const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export function SettingsModal({
  user,
  onUser,
  onClose,
  siteTab,
  initialTab,
}: {
  user: SessionUser | null;
  onUser: (u: SessionUser) => void;
  onClose: () => void;
  /** Optional extra panel for genuinely site-specific prefs; the tab is hidden when omitted. */
  siteTab?: React.ReactNode;
  initialTab?: SettingsTab;
}) {
  const tabs = useMemo(
    () => TABS.filter((t) => t.id !== "site" || siteTab != null),
    [siteTab],
  );
  const groups = useMemo(
    () => [
      {
        label: "Account",
        ids: ["profile", "security", "sessions"] as SettingsTab[],
      },
      {
        label: "Preferences",
        ids: (["appearance", "site"] as SettingsTab[]).filter((id) =>
          tabs.some((t) => t.id === id),
        ),
      },
    ],
    [tabs],
  );

  const [tab, setTab] = useState<SettingsTab>(
    initialTab ?? (user ? "profile" : "appearance"),
  );
  const [here, setHere] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setHere(window.location.href);
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const meta = useMemo(
    () => tabs.find((t) => t.id === tab) ?? tabs[0],
    [tabs, tab],
  );
  const locked = !!meta.account && !user;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      onMouseDown={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[color-mix(in_srgb,#0a0c12_60%,transparent)] backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Network settings"
        className="pop-in relative flex h-[min(640px,92vh)] w-full max-w-[740px] flex-col overflow-hidden rounded-2xl border border-line bg-surface/88 shadow-(--shadow-3) backdrop-blur-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-ink-mid uppercase">
            Network settings
          </span>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close settings"
            className="grid size-7 cursor-pointer place-items-center rounded-md text-ink-dim transition-colors duration-(--dur-fast) outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[204px_1fr]">
          <nav
            aria-label="Settings sections"
            className="scrollbar-none flex gap-1 overflow-x-auto border-b border-line bg-surface-2/28 p-2.5 sm:flex-col sm:gap-0.5 sm:overflow-y-auto sm:border-r sm:border-b-0"
          >
            {user && (
              <div className="hidden items-center gap-2.5 rounded-lg px-2 py-2.5 sm:flex">
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-bold text-white"
                >
                  {(user.displayName || user.email || "?")
                    .charAt(0)
                    .toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">
                    {user.displayName}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-ink-dim">
                    {user.email}
                  </span>
                </span>
              </div>
            )}

            {groups.map((g) => (
              <div key={g.label} className="contents sm:block">
                <div className="hidden px-2 pt-2.5 pb-1 font-mono text-[10px] font-bold tracking-[0.18em] text-ink-dim uppercase sm:block">
                  {g.label}
                </div>
                {g.ids.map((id) => {
                  const t = tabs.find((x) => x.id === id)!;
                  const active = tab === id;
                  const needsAuth = !!t.account && !user;
                  return (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                        active
                          ? "bg-surface-2/65 font-semibold text-ink"
                          : "text-ink-mid hover:bg-surface-2/48 hover:text-ink"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`size-4 shrink-0 transition-colors ${active ? "text-brand" : "text-ink-dim group-hover:text-ink-mid"}`}
                      >
                        {t.icon}
                      </span>
                      <span className="truncate">{t.label}</span>
                      {needsAuth && (
                        <svg
                          viewBox="0 0 24 24"
                          className="ml-auto hidden size-3 text-ink-dim sm:block"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden
                        >
                          <rect x="5" y="11" width="14" height="9" rx="1.5" />
                          <path
                            d="M8 11V8a4 4 0 0 1 8 0v3"
                            strokeLinecap="round"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div key={tab} className="rise-in min-h-0 overflow-y-auto p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="text-[17px] font-semibold text-ink">
                {meta.title}
              </h2>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">
                {meta.blurb}
              </p>
            </div>

            {locked ? (
              <SignInCard here={here} />
            ) : (
              <>
                {tab === "profile" && user && (
                  <ProfileTab user={user} onUser={onUser} here={here} />
                )}
                {tab === "appearance" && (
                  <div className="flex flex-col gap-6">
                    <ThemeControl signedIn={!!user} />
                    <NetworkAccessibilitySettings />
                  </div>
                )}
                {tab === "site" && siteTab}
                {tab === "security" && user && <SecurityTab user={user} />}
                {tab === "sessions" && user && <SessionsTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Signed-out prompt for the account-only tabs ──────────────────────────── */

function SignInCard({ here }: { here: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/48 p-5 text-center backdrop-blur-md">
      <p className="text-sm text-ink-mid">
        Sign in to manage your shared account — one identity across every site
        in the network.
      </p>
      <a
        href={here ? loginHref(here) : "#"}
        className="mt-3.5 inline-flex h-(--ctl-sm) items-center rounded-md bg-brand px-4 text-sm font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        Sign in
      </a>
    </div>
  );
}

/* ── Profile: shared identity + public links + connected accounts ─────────── */

const inputCls =
  "h-(--ctl) w-full rounded-md border border-line bg-surface-2/48 px-3.5 text-[15px] text-ink transition-[border-color] duration-(--dur-fast) outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30";

function ProfileTab({
  user,
  onUser,
  here,
}: {
  user: SessionUser;
  onUser: (u: SessionUser) => void;
  here: string;
}) {
  const [name, setName] = useState(user.displayName);
  const [linkedIn, setLinkedIn] = useState(user.linkedInUrl ?? "");
  const [website, setWebsite] = useState(user.websiteUrl ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const norm = (s: string) => s.trim();
  const dirty =
    (norm(name).length > 0 && norm(name) !== user.displayName) ||
    norm(linkedIn) !== (user.linkedInUrl ?? "") ||
    norm(website) !== (user.websiteUrl ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (norm(name).length === 0) {
      setError("Display name can't be empty.");
      return;
    }
    setError(null);
    setStatus("saving");
    const patch: ProfilePatch = {
      displayName: norm(name),
      linkedInUrl: norm(linkedIn) || null,
      websiteUrl: norm(website) || null,
    };
    try {
      const updated = await updateProfile(patch);
      onUser(updated);
      setName(updated.displayName);
      setLinkedIn(updated.linkedInUrl ?? "");
      setWebsite(updated.websiteUrl ?? "");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setStatus("idle");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3.5 rounded-xl border border-line bg-surface-2/48 p-3.5 backdrop-blur-md">
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-full bg-brand text-xl font-bold text-white"
        >
          {(user.displayName || user.email || "?").charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">
            {user.displayName}
          </div>
          <div className="truncate font-mono text-xs text-ink-dim">
            {user.email}
          </div>
        </div>
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="settings-display-name"
            className="mb-1.5 block text-sm font-medium text-ink"
          >
            Display name
          </label>
          <input
            id="settings-display-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className={inputCls}
          />
          <span className="mt-1.5 block text-xs text-ink-dim">
            Shared identity — the same on every site in the network.
          </span>
        </div>

        <div>
          <div className="mb-2 font-mono text-[10px] font-bold tracking-[0.18em] text-ink-dim uppercase">
            Links
          </div>
          <div className="flex flex-col gap-2.5">
            <LinkField
              id="settings-linkedin"
              label="LinkedIn"
              placeholder="linkedin.com/in/you"
              value={linkedIn}
              onChange={setLinkedIn}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0Z" />
                </svg>
              }
            />
            <LinkField
              id="settings-website"
              label="Website"
              placeholder="your-site.com"
              value={website}
              onChange={setWebsite}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
                </svg>
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || status === "saving"}
            className="h-(--ctl-sm) cursor-pointer rounded-md bg-brand px-4 text-sm font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-40"
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
          {status === "saved" && (
            <span className="text-sm text-brand">Saved ✓</span>
          )}
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
      </form>

      <ConnectedAccounts user={user} onUser={onUser} here={here} />
    </div>
  );
}

function LinkField({
  id,
  label,
  placeholder,
  value,
  onChange,
  icon,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex h-(--ctl) items-center gap-2.5 rounded-md border border-line bg-surface-2/48 px-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
    >
      <span aria-hidden className="shrink-0 text-ink-dim">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={200}
        className="h-full w-full min-w-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-dim"
      />
    </label>
  );
}

/* ── Connected accounts: link/unlink Google & GitHub ──────────────────────── */

const PROVIDER_ICON: Record<string, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  ),
  github: (
    <svg
      viewBox="0 0 24 24"
      className="size-5 text-ink"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.46-2.3 1.2-3.1-.12-.3-.52-1.48.11-3.08 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.6.23 2.78.11 3.08.75.8 1.2 1.84 1.2 3.1 0 4.43-2.7 5.4-5.28 5.69.42.36.79 1.08.79 2.17v3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  ),
};

function ConnectedAccounts({
  user,
  onUser,
  here,
}: {
  user: SessionUser;
  onUser: (u: SessionUser) => void;
  here: string;
}) {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProviders()
      .then((p) => setAvailable(p.providers))
      .catch(() => setAvailable([]));
  }, []);

  const connected = new Set(user.connections.map((c) => c.toLowerCase()));
  // Show every wired provider, plus any already-linked one even if not currently wired.
  const list = Array.from(new Set([...(available ?? []), ...user.connections]));

  const disconnect = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try {
      const updated = await disconnectProvider(provider);
      onUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-2 font-mono text-[10px] font-bold tracking-[0.18em] text-ink-dim uppercase">
        Connected accounts
      </div>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-col gap-2.5">
        {list.length === 0 && (
          <p className="text-[13px] text-ink-dim">
            No external providers are configured.
          </p>
        )}
        {list.map((provider) => {
          const key = provider.toLowerCase();
          const isOn = connected.has(key);
          return (
            <div
              key={key}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/48 px-3.5 py-2.5"
            >
              <span aria-hidden className="shrink-0">
                {PROVIDER_ICON[key] ?? (
                  <span className="grid size-5 place-items-center rounded bg-line text-[10px] font-bold text-ink">
                    {provider.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink capitalize">
                  {provider}
                </div>
                <div className="font-mono text-[11px] text-ink-dim">
                  {isOn ? "Connected" : "Not connected"}
                </div>
              </div>
              {isOn ? (
                <button
                  onClick={() => disconnect(provider)}
                  disabled={busy !== null || connected.size <= 1}
                  title={
                    connected.size <= 1
                      ? "Can't remove your only sign-in method"
                      : undefined
                  }
                  className="h-(--ctl-sm) shrink-0 cursor-pointer rounded-md border border-line px-3 text-[13px] font-semibold text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:border-danger/50 hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy === provider ? "…" : "Disconnect"}
                </button>
              ) : (
                <a
                  href={here ? connectProviderUrl(provider, here) : "#"}
                  className="inline-flex h-(--ctl-sm) shrink-0 items-center rounded-md bg-brand px-3 text-[13px] font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  Connect
                </a>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-dim">
        Sign in with any connected provider. Providers that share your email
        address link to this same account automatically.
      </p>
    </div>
  );
}

/* ── Security: how sign-in works + your roles ────────────────────────────── */

function SecurityTab({ user }: { user: SessionUser }) {
  const row =
    "flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2/48 px-3.5 py-2.5";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className={row}>
        <span className="text-ink-mid">Email</span>
        <span className="truncate font-mono text-[13px] text-ink">
          {user.email}
        </span>
      </div>
      <div className={row}>
        <span className="text-ink-mid">Password</span>
        <span className="text-ink-dim">None — OAuth only</span>
      </div>
      <div className="rounded-xl border border-line bg-surface-2/48 px-3.5 py-2.5">
        <span className="text-ink-mid">Roles</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(user.roles.length ? user.roles : ["member"]).map((r) => (
            <span
              key={r}
              className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-0.5 font-mono text-[11px] font-bold text-brand"
            >
              {r}
            </span>
          ))}
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-dim">
        Identity is proven by Google or GitHub; the network stores no
        credentials. One session cookie on{" "}
        <span className="font-mono text-[12px]">.isaacwallace.dev</span> signs
        you into every site at once — and the Sessions tab can revoke any
        device, immediately.
      </p>
    </div>
  );
}

/* ── Sessions: signed-in devices, revocable ──────────────────────────────── */

function SessionsTab() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    getSessions()
      .then(setSessions)
      .catch(() => setError("Couldn't load sessions."));
  }, []);
  useEffect(load, [load]);

  const revoke = async (s: SessionInfo) => {
    setBusy(s.id);
    setError(null);
    try {
      const res = await revokeSession(s.id);
      if (res.current) {
        window.location.reload();
        return;
      }
      load();
    } catch {
      setError("Couldn't revoke that session.");
    } finally {
      setBusy(null);
    }
  };

  const revokeOthers = async () => {
    setBusy("others");
    setError(null);
    try {
      await revokeOtherSessions();
      load();
    } catch {
      setError("Couldn't revoke the other sessions.");
    } finally {
      setBusy(null);
    }
  };

  if (sessions === null && !error)
    return <p className="text-sm text-ink-dim">Loading sessions…</p>;

  return (
    <div className="flex flex-col gap-2.5">
      {error && <p className="text-sm text-danger">{error}</p>}
      {sessions?.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/48 px-3.5 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              {deviceLabel(s.userAgent)}
              {s.current && (
                <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-px font-mono text-[10px] font-bold text-brand">
                  this device
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-ink-dim">
              {s.ip || "unknown ip"} · active {timeAgo(s.lastSeenUtc)} · since{" "}
              {new Date(s.createdUtc).toLocaleDateString()}
            </div>
          </div>
          <button
            onClick={() => revoke(s)}
            disabled={busy !== null}
            className="h-(--ctl-sm) shrink-0 cursor-pointer rounded-md border border-line px-3 text-[13px] font-semibold text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:border-danger/50 hover:text-danger focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-40"
          >
            {busy === s.id ? "Revoking…" : s.current ? "Sign out" : "Revoke"}
          </button>
        </div>
      ))}
      {sessions && sessions.length > 1 && (
        <button
          onClick={revokeOthers}
          disabled={busy !== null}
          className="mt-1 h-(--ctl-sm) cursor-pointer self-start rounded-md border border-line px-3 text-[13px] font-semibold text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-40"
        >
          {busy === "others" ? "Revoking…" : "Sign out all other sessions"}
        </button>
      )}
      <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
        Every sign-in opens a server-side session; revoking one kills that
        device on its very next request, across the whole network.
      </p>
    </div>
  );
}
