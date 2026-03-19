"use client";

import type { RevenueGroupResult } from "@/lib/revenue-groups-config";

interface Props {
  groups: RevenueGroupResult[];
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function PaceIndicator({ status, deficit }: { status: string; deficit?: number }) {
  if (status === "ahead") {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Ahead of pace" />;
  }
  if (status === "behind") {
    return (
      <span className="text-xs text-amber-400" title="Behind pace">
        behind by {deficit ? formatCurrency(deficit) : "—"}
      </span>
    );
  }
  return null;
}

export function RevenueGoalRings({ groups }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
      {groups.map((group) => {
        const pct = group.annualTarget > 0
          ? Math.min((group.ytdActual / group.annualTarget) * 100, 100)
          : 0;
        const pacePct = group.annualTarget > 0
          ? Math.min((group.ytdPaceExpected / group.annualTarget) * 100, 100)
          : 0;
        const circumference = 2 * Math.PI * 34;
        const strokeDash = (pct / 100) * circumference;
        const deficit = group.paceStatus === "behind"
          ? group.ytdPaceExpected - group.ytdActual
          : undefined;
        const isApproximate = group.groupKey === "roofing_dnr" || group.groupKey === "service";

        // Pace dot position on the ring (angle from 12 o'clock, clockwise)
        const paceAngle = (pacePct / 100) * 360 - 90; // -90 to start from top
        const paceRad = (paceAngle * Math.PI) / 180;
        const paceDotX = 40 + 34 * Math.cos(paceRad);
        const paceDotY = 40 + 34 * Math.sin(paceRad);

        return (
          <div
            key={group.groupKey}
            className="flex flex-col items-center bg-surface-2 rounded-xl p-4"
          >
            <svg width="80" height="80" viewBox="0 0 80 80" className="mb-2">
              <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" className="text-surface" strokeWidth="6" />
              <circle cx="40" cy="40" r="34" fill="none" stroke={group.color} strokeWidth="6"
                strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
                strokeDashoffset={circumference * 0.25} strokeLinecap="round"
                className="transition-all duration-1000 ease-out" />
              {/* Pace marker dot */}
              {pacePct > 0 && (
                <circle
                  cx={paceDotX}
                  cy={paceDotY}
                  r="3.5"
                  fill="white"
                  fillOpacity="0.85"
                  stroke="white"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                >
                  <title>Expected pace: {pacePct.toFixed(0)}%</title>
                </circle>
              )}
              <text x="40" y="37" textAnchor="middle" className="fill-foreground text-sm font-bold" fontSize="14">{pct.toFixed(0)}%</text>
              <text x="40" y="50" textAnchor="middle" className="fill-muted" fontSize="9">{formatCurrency(group.ytdActual)}</text>
            </svg>
            <div className="text-center">
              <div className="flex items-center gap-1.5 justify-center">
                <span className="font-semibold text-sm" style={{ color: group.color }}>{group.displayName}</span>
                <PaceIndicator status={group.paceStatus} deficit={deficit} />
              </div>
              <div className="text-xs text-muted">{formatCurrency(group.annualTarget)} goal</div>
              {group.discoveryGated && (
                <div className="text-[10px] text-amber-500/70 mt-0.5">recognition field not configured</div>
              )}
              {isApproximate && (
                <div className="text-[9px] text-muted/60 italic mt-0.5" title="Revenue based on Zuper job completion data">~approx</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
