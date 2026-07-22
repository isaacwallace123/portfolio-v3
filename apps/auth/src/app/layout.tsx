import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import PrefsBoot from "@/shared/boot/PrefsBoot";
import { THEME_INIT_SCRIPT } from "@iw/core";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Fraunces (optical serif) for the display voice — matching the main site's editorial identity.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: { default: "Sign in · isaacwallace.dev", template: "%s · auth" },
  description: "The identity portal for the isaacwallace.dev network.",
  robots: { index: false, follow: false },
};

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
      </head>
      <body className="flex min-h-screen flex-col">
        <PrefsBoot />
        <header className="flex items-center justify-center pt-9 pb-2">
          <span className="inline-flex items-center gap-2.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[3px] bg-accent shadow-[0_0_12px_var(--accent)]"
            />
            <span className="font-mono text-sm font-bold tracking-[0.14em] text-ink uppercase">
              isaacwallace
            </span>
          </span>
        </header>
        <main className="flex flex-1 items-start justify-center px-5 py-8 sm:items-center">
          {children}
        </main>
        <footer className="pb-7 text-center font-mono text-[10px] tracking-[0.2em] text-ink-dim uppercase">
          one account · every *.isaacwallace.dev site
        </footer>
      </body>
    </html>
  );
}
