import PageHead from "./PageHead";

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
    <div className="mx-auto w-full max-w-[1500px]">
      <PageHead kicker={kicker} title={title} sub={intro} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatusCard label="Gateway" value="Connected" tone="ok" />
        <StatusCard label="Resources" value={String(bullets.length)} />
        <StatusCard label="Control mode" value="Approval required" />
      </div>

      <section className="rounded-2xl border border-line bg-panel/58 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">
              Operator tools
            </h2>
            <p className="mt-1 text-[11px] text-ink-dim">
              Privileged actions remain confirmation-gated when their connectors
              go live.
            </p>
          </div>
          <span className="rounded-full border border-warn/30 bg-warn/8 px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] text-warn uppercase">
            Integration staged
          </span>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
          {bullets.map((tool, index) => (
            <article key={tool} className="min-h-40 bg-panel/94 p-5">
              <div className="flex items-center justify-between">
                <span className="grid size-8 place-items-center rounded-lg border border-line bg-panel-2/55 font-mono text-[9px] font-bold text-accent-bright">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[8px] tracking-[0.09em] text-ink-dim uppercase">
                  Connector
                </span>
              </div>
              <h3 className="mt-6 max-w-sm text-[13px] leading-relaxed font-semibold text-ink">
                {tool}
              </h3>
              <button
                type="button"
                disabled
                className="mt-4 rounded-md border border-line px-2.5 py-1.5 text-[10px] font-semibold text-ink-dim disabled:cursor-not-allowed"
              >
                Configure source
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok";
}) {
  return (
    <div className="rounded-xl border border-line bg-panel/58 p-4 backdrop-blur-xl">
      <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.11em] text-ink-dim uppercase">
        {label}
        {tone && <i className="size-1.5 rounded-full bg-ok" />}
      </div>
      <strong className="mt-3 block text-[15px] text-ink">{value}</strong>
    </div>
  );
}
