import { redirect } from "next/navigation";

// auth is the turnstile, nothing more: sign-in UI here, everything else (profile,
// sessions, prefs) lives in each app's own settings modal against the shared API.
export default function Index() {
  redirect("/login");
}
