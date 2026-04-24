"use client";

export default function ModeSelectStep({
  onSelect,
}: {
  onSelect: (mode: "equipment" | "adder") => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-t-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">What are you requesting?</h2>
        <p className="text-sm text-muted mb-6">
          Pick a category to get started. Tech Ops reviews every request — you&apos;ll get an
          email when it&apos;s added to OpenSolar.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onSelect("equipment")}
            className="text-left rounded-lg border border-t-border bg-surface-2 hover:bg-surface-elevated p-5 transition-colors"
          >
            <div className="text-3xl mb-3">🔋</div>
            <div className="text-base font-semibold text-foreground mb-1">Equipment</div>
            <div className="text-xs text-muted">
              Solar modules, inverters, batteries, EV chargers, racking, monitoring, etc.
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelect("adder")}
            className="text-left rounded-lg border border-t-border bg-surface-2 hover:bg-surface-elevated p-5 transition-colors"
          >
            <div className="text-3xl mb-3">➕</div>
            <div className="text-base font-semibold text-foreground mb-1">Adder</div>
            <div className="text-xs text-muted">
              MPU, trenching, steep-roof, critter guard, service/labor line items, etc.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
