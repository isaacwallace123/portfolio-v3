import type { Metadata } from "next";
import { NETWORK_PREFERENCES_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@iw/core";
import {
  LabMotion,
  NetworkFooter,
  NetworkNavbar,
  NetworkPreferencesBoot,
} from "@iw/ui";
import "./globals.css";

// Site-wide defaults. Each route sets a short `title` and its own `description`; the template turns
// that into "Live topology · HomeOps" without every page having to repeat the brand — the same
// pattern the rest of the network uses.
const SITE_DESCRIPTION =
  "Operate a real three-node Kubernetes homelab: inspect its live architecture, provision a disposable practice cluster, and work incidents on it.";

export const metadata: Metadata = {
  title: {
    default: "HomeOps — operate a real homelab platform",
    template: "%s · HomeOps",
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL("https://homelab.isaacwallace.dev"),
  applicationName: "HomeOps",
  authors: [{ name: "Isaac Wallace", url: "https://isaacwallace.dev" }],
  openGraph: {
    type: "website",
    siteName: "HomeOps",
    url: "/",
    title: "HomeOps — operate a real homelab platform",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "HomeOps — operate a real homelab platform",
    description: SITE_DESCRIPTION,
  },
};

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/practice", label: "Practice" },
  { href: "/ranked", label: "Ranked" },
  { href: "/topology", label: "Live topology" },
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
