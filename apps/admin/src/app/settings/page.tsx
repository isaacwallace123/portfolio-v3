import Planned from "@/shared/ui/Planned";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Planned
      kicker="System"
      title="Settings"
      intro="Configuration for the control plane and the shared API."
      bullets={[
        "Admin email allow-list (who is admin by default)",
        "OAuth providers: which are enabled",
        "Sign-in sessions: active devices, revoke",
        "Audit log of admin actions",
        "API health, rate-limit config, feature flags",
      ]}
    />
  );
}
