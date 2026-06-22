/** Small ON/OFF badge for a flow's enabled state. Theme-token colors only. */
export function FlowStatusPill({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        on
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-surface-2 text-muted"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          on ? "bg-emerald-400" : "bg-muted/50"
        }`}
      />
      {on ? "On" : "Off"}
    </span>
  );
}
