import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import Link from "next/link";
import PrefsBoot from "@/shared/boot/PrefsBoot";
import UserMenu from "@/widgets/UserMenu";
import { THEME_INIT_SCRIPT } from "@iw/core";
import "./globals.css";

// Inter for body/UI, Fraunces (optical serif) for display — a warmer, more
// characterful editorial voice than the old system serif, loaded self-hosted.
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
        <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
          <div className="shell flex h-16 items-center gap-6">
            <Link
              href="/"
              className="font-display text-lg font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Isaac Wallace
            </Link>
            <nav className="ml-auto flex items-center gap-5 text-sm text-ink-mid">
              <a
                href="#labs"
                className="rounded-md transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Labs
              </a>
              <a
                href="#network"
                className="rounded-md transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Network
              </a>
              <a
                href="#stack"
                className="rounded-md transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                Stack
              </a>
              <a
                href="#about"
                className="rounded-md transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                About
              </a>
              <span aria-hidden className="h-4 w-px bg-line-2" />
              <a
                href="https://github.com/isaacwallace123"
                aria-label="GitHub — isaacwallace123"
                className="rounded-md text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-[18px]"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.46-2.3 1.2-3.1-.12-.3-.52-1.48.11-3.08 0 0 .98-.31 3.2 1.18a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.18 3.2-1.18.63 1.6.23 2.78.11 3.08.75.8 1.2 1.84 1.2 3.1 0 4.43-2.7 5.4-5.28 5.69.42.36.79 1.08.79 2.17v3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
                </svg>
              </a>
              <a
                href="https://www.linkedin.com/in/isaac-wallace/"
                aria-label="LinkedIn — Isaac Wallace"
                className="rounded-md text-ink-mid transition-colors duration-(--dur-fast) outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-[18px]"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0Z" />
                </svg>
              </a>
              <UserMenu />
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-8 text-[13px] text-ink-dim">
          <div className="shell flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>© {new Date().getFullYear()} Isaac Wallace</span>
            <span aria-hidden>·</span>
            <a
              href="mailto:goosewal@gmail.com"
              className="transition-colors hover:text-ink"
            >
              goosewal@gmail.com
            </a>
            <span aria-hidden>·</span>
            <a
              href="https://github.com/isaacwallace123"
              className="transition-colors hover:text-ink"
            >
              GitHub
            </a>
            <span aria-hidden>·</span>
            <a
              href="https://www.linkedin.com/in/isaac-wallace/"
              className="transition-colors hover:text-ink"
            >
              LinkedIn
            </a>
            <span className="ml-auto font-mono text-[11px] tracking-[0.14em] uppercase">
              one account, four sites
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
