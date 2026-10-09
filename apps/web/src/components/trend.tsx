/** Last sale vs median: ▲ +4.2% / ▼ -3% / = ; text ink, the arrow carries the direction. */
export function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  if (Math.abs(pct) < 0.5) return <span className="tabular-nums">=</span>;
  return (
    <span className="tabular-nums">
      {pct > 0 ? '▲ +' : '▼ '}
      {pct}%
    </span>
  );
}
