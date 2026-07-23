export default function PageHead({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-7 flex flex-col gap-3 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="kicker">{kicker}</div>
        <h1 className="mt-3 max-w-4xl text-[clamp(28px,4vw,48px)] font-semibold tracking-[-0.05em] text-ink">
          {title}
        </h1>
        {sub && (
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-mid">
            {sub}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] text-ink-dim uppercase">
        <span className="size-1.5 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
        Private operator surface
      </div>
    </div>
  );
}
