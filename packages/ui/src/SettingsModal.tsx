"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deviceLabel,
  getSessions,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
  type SessionInfo,
  type SessionUser,
} from "@iw/core";
import { ThemeControl } from "./ThemeControl";

// The full in-app settings surface, shared across every site. Structure is identical everywhere;
// each app wears its own palette via the design-contract tokens (surface / ink / brand / danger),
// and passes its own cosmetic panel as `siteTab` (the one genuinely per-subdomain part). The auth
// sections (Profile, Sessions) talk to the shared API. Portaled to <body> because the navbar's
// backdrop-blur is a containing block that would trap position:fixed.

type Tab = "profile" | "appearance" | "security" | "sessions" | "site";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "security", label: "Sign-in & security" },
  { id: "sessions", label: "Sessions" },
  { id: "site", label: "This site" },
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
}: {
  user: SessionUser | null;
  onUser: (u: SessionUser) => void;
  onClose: () => void;
  /** This app's cosmetic ("This site") panel — localStorage-only prefs, per subdomain. */
  siteTab: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("profile");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      onMouseDown={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) onClose();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[color-mix(in_srgb,#0a0c12_55%,transparent)] backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="pop-in relative flex h-[min(560px,90vh)] w-full max-w-[620px] flex-col rounded-xl border border-line bg-surface shadow-(--shadow-3)"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="font-mono text-[11px] font-bold tracking-[0.2em] text-ink-mid uppercase">
            Settings
          </span>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close settings"
            className="grid size-7 cursor-pointer place-items-center rounded-md text-ink-dim transition-colors duration-(--dur-fast) outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[170px_1fr]">
          <nav
            aria-label="Settings sections"
            className="flex scrollbar-none gap-1 overflow-x-auto border-b border-line p-2 sm:flex-col sm:border-r sm:border-b-0"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`shrink-0 cursor-pointer rounded-md px-3 py-2 text-left text-[13px] transition-colors duration-(--dur-fast) outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                  tab === t.id
                    ? "bg-surface-2 font-semibold text-ink"
                    : "text-ink-mid hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div key={tab} className="rise-in min-h-0 overflow-y-auto p-5">
            {/* Appearance and This-site work signed-out (theme is network-wide even for guests);
                the account tabs need a session. */}
            {!user && tab !== "appearance" && tab !== "site" ? (
              <p className="text-sm text-ink-dim">
                Sign in to manage your shared account.
              </p>
            ) : (
              <>
                {tab === "profile" && user && (
                  <ProfileTab user={user} onUser={onUser} />
                )}
                {tab === "appearance" && <ThemeControl signedIn={!!user} />}
                {tab === "security" && user && <SecurityTab user={user} />}
                {tab === "sessions" && user && <SessionsTab />}
                {tab === "site" && siteTab}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Profile: shared identity, persisted via the API ─────────────────────── */

function ProfileTab({
  user,
  onUser,
}: {
  user: SessionUser;
  onUser: (u: SessionUser) => void;
}) {
  const [name, setName] = useState(user.displayName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim().length > 0 && name.trim() !== user.displayName;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus("saving");
    try {
      const updated = await updateProfile(name.trim());
      onUser(updated);
      setName(updated.displayName);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setStatus("idle");
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-full bg-brand text-xl font-bold text-white"
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
      <form onSubmit={save}>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="h-(--ctl) w-full rounded-md border border-line bg-surface-2 px-3.5 text-[15px] text-ink transition-[border-color] duration-(--dur-fast) outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
          <span className="text-xs font-normal text-ink-dim">
            Shared identity — the same on every site in the network.
          </span>
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || status === "saving"}
            className="h-(--ctl-sm) cursor-pointer rounded-md bg-brand px-4 text-sm font-semibold text-white transition-opacity duration-(--dur-fast) outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-40"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
          {status === "saved" && <span className="text-sm text-brand">Saved ✓</span>}
          {error && <span className="text-sm text-danger">{error}</span>}
        </div>
      </form>
    </div>
  );
}

/* ── Security: how sign-in works + your roles ────────────────────────────── */

function SecurityTab({ user }: { user: SessionUser }) {
  const row = "flex items-center justify-between gap-4 rounded-md border border-line bg-surface-2 px-3.5 py-2.5";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className={row}>
        <span className="text-ink-mid">Email</span>
        <span className="truncate font-mono text-[13px] text-ink">{user.email}</span>
      </div>
      <div className={row}>
        <span className="text-ink-mid">Password</span>
        <span className="text-ink-dim">None — OAuth only</span>
      </div>
      <div className="rounded-md border border-line bg-surface-2 px-3.5 py-2.5">
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
        Identity is proven by Google or GitHub; the network stores no credentials. One session
        cookie on <span className="font-mono text-[12px]">.isaacwallace.dev</span> signs you into
        every site at once — and the Sessions tab can revoke any device, immediately.
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
          className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-2.5"
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
        Every sign-in opens a server-side session; revoking one kills that device on its very next
        request, across the whole network.
      </p>
    </div>
  );
}
