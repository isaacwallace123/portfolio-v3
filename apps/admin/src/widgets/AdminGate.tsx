"use client";

import { useEffect, useState } from "react";
import {
  adoptAccountTheme,
  getMe,
  HOME_URL,
  loginHref,
  type SessionUser,
} from "@iw/core";
import Shell from "./Shell";

type State =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "forbidden"; user: SessionUser }
  | { status: "ok"; user: SessionUser };

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    getMe().then((user) => {
      if (!alive) return;
      if (user) adoptAccountTheme(user.theme);
      if (!user) {
        setState({ status: "redirecting" });
        window.location.replace(loginHref(window.location.href));
      } else if (!user.roles.includes("admin")) {
        setState({ status: "forbidden", user });
      } else {
        setState({ status: "ok", user });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading" || state.status === "redirecting") {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-ink-dim">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          {state.status === "loading"
            ? "Verifying access…"
            : "Redirecting to sign in…"}
        </div>
      </div>
    );
  }

  if (state.status === "forbidden") {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-panel/80 p-7 text-center shadow-(--shadow-3) backdrop-blur-xl">
          <span
            aria-hidden
            className="mx-auto mb-4 block size-3 rounded-[3px] bg-danger shadow-[0_0_14px_var(--danger)]"
          />
          <h1 className="text-lg font-bold">Admin access required</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-mid">
            {state.user.email} is signed in, but does not hold the admin role.
          </p>
          <a
            href={HOME_URL}
            className="mt-5 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Return to portfolio
          </a>
        </div>
      </div>
    );
  }

  return <Shell user={state.user}>{children}</Shell>;
}
