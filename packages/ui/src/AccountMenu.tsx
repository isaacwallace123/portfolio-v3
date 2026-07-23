"use client";

import { useEffect, useRef, useState } from "react";
import { ADMIN_URL, loginHref, logout, type SessionUser } from "@iw/core";

export function AccountMenu({
  user,
  here,
  onOpenSettings,
}: {
  user: SessionUser | null | undefined;
  here: string;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (user === undefined) {
    return (
      <span aria-hidden className="h-9 w-28 rounded-[10px] bg-surface-2" />
    );
  }

  if (!user) {
    return (
      <a
        href={loginHref(here)}
        className="inline-flex h-9 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink outline-none transition-colors duration-(--dur-fast) hover:border-line-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        Sign in
      </a>
    );
  }

  const isAdmin = user.roles.includes("admin");
  const initial = (user.displayName || user.email || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Open account menu for ${user.displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 max-w-44 items-center gap-2 rounded-[10px] border border-line bg-surface px-1.5 pr-2.5 text-ink outline-none transition-colors duration-(--dur-fast) hover:border-line-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-brand font-mono text-[10px] font-bold text-white"
        >
          {initial}
        </span>
        <span className="max-w-20 truncate text-[12px] font-semibold sm:max-w-28">
          {user.displayName}
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`size-3 shrink-0 text-ink-dim transition-transform ${open ? "rotate-180" : ""}`}
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
          className="pop-in absolute right-0 z-50 mt-2 w-60 origin-top-right overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-(--shadow-3)"
        >
          <div className="mb-1 border-b border-line px-3 py-2.5">
            <div className="truncate text-[13px] font-semibold text-ink">
              {user.displayName}
            </div>
            <div className="truncate font-mono text-[10px] text-ink-dim">
              {user.email}
            </div>
          </div>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-surface-2"
          >
            Settings
            <span aria-hidden className="text-ink-dim">
              ·
            </span>
          </button>
          {isAdmin && (
            <a
              href={ADMIN_URL}
              role="menuitem"
              className="flex items-center justify-between rounded-md px-3 py-2 text-[13px] text-ink transition-colors hover:bg-surface-2"
            >
              Admin console
              <span aria-hidden className="text-ink-dim">
                ↗
              </span>
            </a>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              await logout();
              window.location.reload();
            }}
            className="mt-1 block w-full cursor-pointer border-t border-line px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
