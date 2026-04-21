export function PaidInFullIndicator({
  flag,
  computedPct,
}: {
  flag: boolean | null;
  computedPct: number;
}) {
  if (flag === null) return <span className="text-muted">—</span>;

  const computedPaid = computedPct >= 99.9;
  const disagreement =
    (flag === true && !computedPaid) || (flag === false && computedPaid);

  return (
    <span className="inline-flex items-center gap-1">
      {flag ? (
        <span className="text-emerald-400" title="HubSpot paid_in_full = true">✓</span>
      ) : (
        <span className="text-muted" title="HubSpot paid_in_full = false">—</span>
      )}
      {disagreement && (
        <span
          className="text-amber-400 text-xs"
          title="HubSpot flag and milestone statuses disagree — trust the milestone statuses."
        >
          ⚠️
        </span>
      )}
    </span>
  );
}
