export default function QuickActionsCard() {
  return (
    <div className="rounded-lg border border-dashed border-t-border bg-surface-2/10 p-3">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Quick Actions
      </h3>
      <p className="text-[10px] text-muted">
        Edit fields, sync to HubSpot, schedule...
      </p>
      <p className="mt-1 text-[9px] italic text-muted/50">Coming in V2</p>
    </div>
  );
}
