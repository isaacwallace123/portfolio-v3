import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Nav from "@/widgets/Nav";
import PrefsBoot from "@/shared/boot/PrefsBoot";
import { Toaster } from "@/shared/ui/sonner";
import { THEME_INIT_SCRIPT } from "@iw/core";
import "./globals.css";

// Space Grotesk gives the UI a technical, geometric edge; JetBrains Mono is the
// data/terminal voice everywhere the console shows commands and output.
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
    "A self-hosted cyber range on Proxmox: attackers, defenders, and victim systems on isolated networks. Watch recorded attack-and-defend scenarios as case studies, or the live VM view of scenarios running now.",
  metadataBase: new URL("https://cyberlab.isaacwallace.dev"),
  openGraph: {
    title: "cyberlab — a self-hosted cyber range",
    description:
      "Recorded attack-and-defend case studies and a live view of scenarios running on real VMs.",
    type: "website",
  },
};

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
      </head>
      <body className="flex min-h-screen flex-col">
        <PrefsBoot />
        <Nav />
        <main className="flex-1">{children}</main>
        <footer className="mt-10 border-t border-line py-8 text-[13px] text-ink-dim">
          <div className="shell flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono font-bold tracking-[0.08em] text-ink-mid">
              cyberlab
            </span>
            <span aria-hidden>·</span>
            <span>
              a project by{" "}
              <a
                href="https://isaacwallace.dev"
                className="text-ink-mid underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Isaac Wallace
              </a>
            </span>
            <span aria-hidden>·</span>
            <span>owned lab, read-only public views</span>
            <span className="ml-auto inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase">
              <span
                aria-hidden
                className="size-1.5 animate-blip rounded-full bg-responder"
              />
              range · proxmox · isolated nets
            </span>
          </div>
        </footer>
        <Toaster />
      </body>
    </html>
  );
}
