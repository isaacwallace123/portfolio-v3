"use client";

import { useSearchParams } from "next/navigation";
import LoginPanel from "./LoginPanel";

// Reads ?returnUrl from the query (a client hook, so it's isolated in its own component behind a
// Suspense boundary) and hands it to the login panel.
export default function LoginReturn() {
  const params = useSearchParams();
  return <LoginPanel returnTo={params.get("returnUrl") ?? ""} />;
}
