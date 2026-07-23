import type { Metadata } from "next";
import { NETWORK_PREFERENCES_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@iw/core";
import {
  LabMotion,
  NetworkFooter,
  NetworkNavbar,
  NetworkPreferencesBoot,
} from "@iw/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "HomeOps — operate a real homelab platform",
  description:
    "Interactive SRE drills running on Isaac Wallace's Kubernetes homelab.",
  metadataBase: new URL("https://homelab.isaacwallace.dev"),
};

const NAV_LINKS = [
  { href: "#arena", label: "Live arena" },
  { href: "#drills", label: "Drills" },
  { href: "#platform", label: "Platform" },
] as const;

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
      <body className="flex min-h-screen flex-col">
        <LabMotion variant="homelab" />
        <NetworkPreferencesBoot />
        <NetworkNavbar current="homelab" links={NAV_LINKS} />
        <div className="flex-1">{children}</div>
        <NetworkFooter current="homelab" />
      </body>
    </html>
  );
}
