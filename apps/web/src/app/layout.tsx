import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { NETWORK_PREFERENCES_INIT_SCRIPT, THEME_INIT_SCRIPT } from "@iw/core";
import { NetworkFooter, NetworkNavbar, NetworkPreferencesBoot } from "@iw/ui";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: {
    default: "Isaac Wallace — infrastructure, security, AI",
    template: "%s · isaacwallace.dev",
  },
  description:
    "The portfolio network of Isaac Wallace: a main site and three working labs — a cyber range, a homelab, and an AI lab — all running on self-hosted infrastructure.",
  metadataBase: new URL("https://isaacwallace.dev"),
};

const NAV_LINKS = [
  { href: "#labs", label: "Labs" },
  { href: "#network", label: "Network" },
  { href: "#stack", label: "Stack" },
  { href: "#about", label: "About" },
] as const;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable}`}
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
        <NetworkPreferencesBoot />
        <NetworkNavbar current="main" links={NAV_LINKS} />
        <main className="flex-1">{children}</main>
        <NetworkFooter current="main" />
      </body>
    </html>
  );
}
