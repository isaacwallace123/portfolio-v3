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
    <div className="mb-6">
      <div className="kicker">{kicker}</div>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
      {sub && <p className="mt-1.5 max-w-2xl text-sm text-ink-mid">{sub}</p>}
    </div>
  );
}
