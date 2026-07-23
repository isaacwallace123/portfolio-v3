import type { Metadata } from "next";
import AdminGate from "@/widgets/AdminGate";
import { NETWORK_PREFERENCES_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@iw/core";
import { NetworkPreferencesBoot } from "@iw/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "control · admin.isaacwallace.dev",
    template: "%s · control",
  },
  description: "Central control plane for the isaacwallace.dev network.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          dangerouslySetInnerHTML={{
            __html: NETWORK_PREFERENCES_INIT_SCRIPT,
          }}
        />
      </head>
      <body>
        <NetworkPreferencesBoot />
        <AdminGate>{children}</AdminGate>
      </body>
    </html>
  );
}
