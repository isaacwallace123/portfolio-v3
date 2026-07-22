import Link from "next/link";

// Themed 404 for the control plane.
export default function NotFound() {
  return (
    <section className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div>
        <div className="kicker text-warn">404 · unknown route</div>
        <h1 className="mt-4 text-2xl font-bold tracking-[-0.01em]">
          Nothing at this address
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-[15px] text-ink-mid">
          The control plane doesn&apos;t know this path. Head back to the
          console.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex h-11 items-center rounded-md bg-accent px-5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Console home
        </Link>
      </div>
    </section>
  );
}
