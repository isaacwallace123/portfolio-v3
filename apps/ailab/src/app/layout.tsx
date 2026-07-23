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
  title: "AI Lab — local model experiments under observation",
  description:
    "Configure, run, and inspect real local-AI experiments on Isaac Wallace's GPU lab.",
  metadataBase: new URL("https://ailab.isaacwallace.dev"),
};

const NAV_LINKS = [
  { href: "#arena", label: "Experiment" },
  { href: "#pipeline", label: "RAG forge" },
  { href: "#registry", label: "Models" },
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
        <LabMotion variant="ailab" ambient={false} />
        <NetworkPreferencesBoot />
        <NetworkNavbar current="ailab" links={NAV_LINKS} />
        <div className="flex-1">{children}</div>
        <NetworkFooter current="ailab" />
      </body>
    </html>
  );
}
