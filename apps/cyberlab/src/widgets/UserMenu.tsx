"use client";

import { useEffect, useRef, useState } from "react";
import {
  ADMIN_URL,
  getMe,
  loginHref,
  logout,
  type SessionUser,
} from "@iw/core";
import { SettingsModal } from "@iw/ui";
import AppearanceSettings from "@/widgets/AppearanceSettings";
import SiteSettings from "@/widgets/SiteSettings";

// Account menu for the nav, in the ops-console idiom. Opens on click AND hover, but click +
// keyboard + touch all work and it closes on Escape / outside-click. Login AND account settings
// both live on the account center (auth.isaacwallace.dev); this only reads the shared session.
export default function UserMenu() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [here, setHere] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHere(window.location.href);
    let alive = true;
    getMe().then((u) => alive && setUser(u));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  if (user === undefined) return <span aria-hidden className="h-9 w-16" />;

  if (!user) {
    return (
      <a
        href={loginHref(here)}
        className="rounded-md px-3 py-2 text-sm text-ink-mid transition-colors outline-none hover:bg-panel-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        Sign in
      </a>
    );
  }

  const isAdmin = user.roles.includes("admin");
  const item =
    "flex items-center justify-between px-3.5 py-2 text-sm text-ink transition-colors hover:bg-panel-2";

  return (
    <div
      ref={wrap}
      className="relative"
      onMouseEnter={hoverOpen}
      onMouseLeave={hoverClose}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-ink-mid transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span aria-hidden className="size-[7px] rounded-[2px] bg-responder" />
        {user.displayName}
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="pop-in absolute right-0 z-50 mt-2 w-56 origin-top-right overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-(--shadow-3)"
        >
          <div className="border-b border-line px-3.5 py-2.5">
            <div className="truncate text-sm font-semibold text-ink">
              {user.displayName}
            </div>
            <div className="truncate font-mono text-[11px] text-ink-dim">
              {user.email}
            </div>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
            className={`${item} w-full cursor-pointer text-left`}
          >
            Settings
          </button>
          {isAdmin && (
            <a href={ADMIN_URL} role="menuitem" className={item}>
              Admin console
              <span aria-hidden className="text-ink-dim">
                ↗
              </span>
            </a>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              await logout();
              setOpen(false);
              window.location.reload();
            }}
            className="block w-full cursor-pointer px-3.5 py-2 text-left text-sm text-ink transition-colors hover:bg-panel-2"
          >
            Sign out
          </button>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          user={user}
          onUser={setUser}
          onClose={() => setSettingsOpen(false)}
          appearanceTab={<AppearanceSettings />}
          siteTab={<SiteSettings />}
        />
      )}
    </div>
  );
}
