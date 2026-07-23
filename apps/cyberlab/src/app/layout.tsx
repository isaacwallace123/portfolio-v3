import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { NETWORK_PREFERENCES_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@iw/core";
import {
  LabMotion,
  NetworkFooter,
  NetworkNavbar,
  NetworkPreferencesBoot,
} from "@iw/ui";
import { Toaster } from "@/shared/ui/sonner";
import SiteSettings from "@/widgets/SiteSettings";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: {
    default: "cyberlab — a self-hosted cyber range",
    template: "%s · cyberlab",
  },
  description:
    "A self-hosted cyber range on Proxmox: watch recorded attack-and-defend scenarios or inspect live runs on real VMs.",
  metadataBase: new URL("https://cyberlab.isaacwallace.dev"),
};

const NAV_LINKS = [
  { href: "/", label: "Overview" },
  { href: "/scenarios", label: "Case studies" },
  { href: "/live", label: "Live range" },
] as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          dangerouslySetInnerHTML={{
            __html: NETWORK_PREFERENCES_INIT_SCRIPT,
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <LabMotion variant="cyberlab" />
        <NetworkPreferencesBoot />
        <NetworkNavbar
          current="cyberlab"
          links={NAV_LINKS}
          siteTab={<SiteSettings />}
        />
        <main className="flex-1">{children}</main>
        <NetworkFooter current="cyberlab" />
        <Toaster />
      </body>
    </html>
  );
}
