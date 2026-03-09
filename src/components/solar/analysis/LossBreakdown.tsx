/**
 * Loss Breakdown Card
 *
 * Shows the detailed loss profile used in the simulation:
 * soiling, mismatch, DC/AC wiring, availability, LID, snow, nameplate.
 */

"use client";

interface LossBreakdownProps {
  lossProfile: Record<string, unknown> | null;
  siteConditions: Record<string, unknown> | null;
}

const LOSS_ITEMS: { key: string; label: string; description: string }[] = [
  { key: "soiling", label: "Soiling", description: "Dirt, dust, pollen on panels" },
  { key: "mismatch", label: "Module Mismatch", description: "Manufacturing variance between panels" },
  { key: "dcWiring", label: "DC Wiring", description: "DC cable resistance losses" },
  { key: "acWiring", label: "AC Wiring", description: "AC cable resistance losses" },
  { key: "availability", label: "Availability", description: "Downtime, grid outages, maintenance" },
  { key: "lid", label: "LID", description: "Light-induced degradation (first year)" },
  { key: "snow", label: "Snow", description: "Snow cover on panels" },
  { key: "nameplate", label: "Nameplate", description: "Deviation from rated power" },
];

const DEFAULTS: Record<string, number> = {
  soiling: 2.0,
  mismatch: 2.0,
  dcWiring: 2.0,
  acWiring: 1.0,
  availability: 3.0,
  lid: 1.5,
  snow: 0.0,
  nameplate: 1.0,
};

export default function LossBreakdown({ lossProfile, siteConditions }: LossBreakdownProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lp = lossProfile as any;
  const groundAlbedo = (siteConditions?.groundAlbedo as number) ?? 0.2;

  // Calculate total derate
  let totalDerate = 1.0;
  for (const item of LOSS_ITEMS) {
    const val = (lp?.[item.key] ?? DEFAULTS[item.key]) / 100;
    totalDerate *= (1 - val);
  }
  const totalLoss = (1 - totalDerate) * 100;

  return (
    <div className="rounded-lg border border-t-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">System Losses</h3>
        <span className="text-xs text-red-400 font-medium">
          {totalLoss.toFixed(1)}% total derate
        </span>
      </div>

      <div className="space-y-1">
        {LOSS_ITEMS.map((item) => {
          const value = (lp?.[item.key] ?? DEFAULTS[item.key]) as number;
          const isDefault = !lp || lp[item.key] === undefined;

          return (
            <div
              key={item.key}
              className="flex items-center justify-between text-xs group"
            >
              <div className="flex items-center gap-2">
                <span className="text-muted">{item.label}</span>
                <span className="text-muted/40 text-[10px] hidden group-hover:inline">
                  {item.description}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* Visual bar */}
                <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500/60 rounded-full"
                    style={{ width: `${Math.min(value * 10, 100)}%` }}
                  />
                </div>
                <span className={`font-medium w-12 text-right ${
                  isDefault ? "text-muted/60" : "text-foreground"
                }`}>
                  {value.toFixed(1)}%
                  {isDefault && <span className="text-[9px] text-muted/40 ml-0.5">*</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ground albedo */}
      <div className="flex items-center justify-between text-xs pt-1 border-t border-t-border">
        <span className="text-muted">Ground Albedo</span>
        <span className="text-foreground font-medium">{(groundAlbedo * 100).toFixed(0)}%</span>
      </div>

      {/* Default indicator */}
      {(!lp || Object.keys(lp || {}).length === 0) && (
        <div className="text-[10px] text-muted/40">
          * Default values — customize in project settings
        </div>
      )}
    </div>
  );
}
