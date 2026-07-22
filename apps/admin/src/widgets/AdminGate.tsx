"use client";

import { useEffect, useState } from "react";
import { adoptAccountTheme, AUTH_URL, getMe, type SessionUser } from "@iw/core";
import Shell from "./Shell";

// Client-side gate: renders the console only for a signed-in admin. This is UX, not the security
// boundary — every admin API call is authorised server-side, and in production Cloudflare Access
// gates the whole subdomain at the edge before this even loads.
type State =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "forbidden"; user: SessionUser }
  | { status: "ok"; user: SessionUser };

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    getMe().then((user) => {
      if (!alive) return;
      if (user) adoptAccountTheme(user.theme); // follow the account's saved theme on this device
      if (!user) setState({ status: "anon" });
      else if (!user.roles.includes("admin"))
        setState({ status: "forbidden", user });
      else setState({ status: "ok", user });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-ink-dim">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          Verifying access…
        </div>
      </div>
    );
  }

  if (state.status === "anon") {
    const back =
      typeof window !== "undefined" ? window.location.href : AUTH_URL;
    return (
      <Centered
        title="Sign in required"
        body="This is the control plane. Sign in at the identity portal — your session carries over here automatically."
        actionHref={`${AUTH_URL}/login?returnUrl=${encodeURIComponent(back)}`}
        actionLabel="Go to sign in →"
      />
    );
  }

  if (state.status === "forbidden") {
    return (
      <Centered
        title="Not authorised"
        body={`You're signed in as ${state.user.email}, but this console is admin-only. Ask an existing admin to grant you the role.`}
        actionHref={AUTH_URL}
        actionLabel="Back to isaacwallace.dev"
      />
    );
  }

  return <Shell user={state.user}>{children}</Shell>;
}

function Centered({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-7 text-center">
        <span
          aria-hidden
          className="mx-auto mb-4 block size-3 rounded-[3px] bg-accent shadow-[0_0_14px_var(--accent)]"
        />
        <h1 className="text-lg font-bold">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-mid">{body}</p>
        <a
          href={actionHref}
          className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          {actionLabel}
        </a>
      </div>
    </div>
  );
}
