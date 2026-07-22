import PageHead from "./PageHead";

// Reusable placeholder for sections that are on the roadmap but not built yet. Honest about status
// while making the intended shape of the control plane visible.
export default function Planned({
  kicker,
  title,
  intro,
  bullets,
}: {
  kicker: string;
  title: string;
  intro: string;
  bullets: string[];
}) {
  return (
    <>
      <PageHead kicker={kicker} title={title} sub={intro} />
      <div className="rounded-xl border border-dashed border-line bg-panel/50 p-6">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 font-mono text-[10px] tracking-wide text-warn uppercase">
          <span className="size-1.5 rounded-full bg-warn" />
          Planned
        </div>
        <p className="mb-4 max-w-2xl text-sm text-ink-mid">
          What this section will manage:
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2.5 rounded-lg border border-line bg-panel-2 px-3.5 py-3 text-sm text-ink"
            >
              <span
                aria-hidden
                className="mt-1 size-1.5 shrink-0 rounded-full bg-accent"
              />
              {b}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
