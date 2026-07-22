import Link from "next/link";

// Themed 404 in the editorial voice of the main site.
export default function NotFound() {
  return (
    <section className="shell grid min-h-[60vh] place-items-center py-16 text-center">
      <div className="rise-in">
        <div className="eyebrow">404 · not found</div>
        <h1 className="mt-4 font-display text-(length:--fs-h1) font-bold tracking-[-0.01em]">
          This page isn&apos;t part of the network
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-[15px] text-ink-mid">
          Whatever used to be here has moved, or never was. The labs are all
          still exactly where they should be.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-(--ctl-lg) items-center rounded-md bg-ink px-5 text-[15px] font-semibold text-paper transition-opacity duration-(--dur-fast) outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Back home
          </Link>
          <Link
            href="/#labs"
            className="inline-flex h-(--ctl-lg) items-center rounded-md border border-line bg-card px-5 text-[15px] font-semibold text-ink transition-colors duration-(--dur-fast) outline-none hover:border-line-2 hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            The labs
          </Link>
        </div>
      </div>
    </section>
  );
}
