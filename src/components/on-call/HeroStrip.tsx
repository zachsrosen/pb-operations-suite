"use client";

type Pool = {
  poolId: string;
  poolName: string;
  region: string;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  weekendShiftStart: string;
  weekendShiftEnd: string;
  /** Pool startDate (YYYY-MM-DD). Optional for back-compat with stale clients. */
  startDate?: string;
  date: string;
  crewMember: { id: string; name: string; email: string | null } | null;
  source: string | null;
};

const POOL_THEMES: Record<string, { grad: string; border: string; text: string; icon: string }> = {
  California: { grad: "from-orange-500/15 to-orange-500/5", border: "border-orange-500/30", text: "text-orange-400", icon: "🌴" },
  Colorado: { grad: "from-blue-500/15 to-blue-500/5", border: "border-blue-500/30", text: "text-blue-400", icon: "🏔" },
  Denver: { grad: "from-blue-500/15 to-blue-500/5", border: "border-blue-500/30", text: "text-blue-400", icon: "🏔" },
  "Southern CO": { grad: "from-emerald-500/15 to-emerald-500/5", border: "border-emerald-500/30", text: "text-emerald-400", icon: "⛰" },
};

function themeFor(name: string) {
  return POOL_THEMES[name] ?? { grad: "from-surface to-surface-2", border: "border-t-border", text: "text-foreground", icon: "📞" };
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}${suffix}`;
}

function tzAbbr(tz: string): string {
  return tz.includes("Los_Angeles") ? "PT" : "MT";
}

function shiftWindowFor(p: Pool): string {
  const dow = dayOfWeek(p.date);
  const weekend = dow === 0 || dow === 6;
  const start = weekend ? p.weekendShiftStart : p.shiftStart;
  const end = weekend ? p.weekendShiftEnd : p.shiftEnd;
  const label = weekend ? "weekend" : "weekday";
  return `${fmtTime(start)} → ${fmtTime(end)} ${tzAbbr(p.timezone)} · ${label} hours`;
}

function fmtStartDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function HeroStrip({ pools }: { pools: Pool[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {pools.map((p) => {
        const theme = themeFor(p.poolName);
        const preStart = p.source === "pre-start";
        return (
          <div
            key={p.poolId}
            className={`bg-gradient-to-br ${theme.grad} border ${theme.border} rounded-xl p-5`}
          >
            <div className={`text-xs uppercase tracking-wider ${theme.text} opacity-80 mb-1`}>
              {theme.icon} {p.poolName}
            </div>
            <div className="text-2xl font-bold mb-1 text-foreground">
              {preStart ? (
                <span className="text-muted italic">Schedule starts {fmtStartDate(p.startDate ?? "2026-05-04")}</span>
              ) : (
                p.crewMember?.name ?? <span className="text-muted italic">Unassigned</span>
              )}
            </div>
            <div className="text-xs text-muted mb-4">{shiftWindowFor(p)}</div>
            {p.crewMember?.email && (
              <div className="flex gap-2 text-xs">
                <a
                  href={`mailto:${p.crewMember.email}`}
                  className="px-3 py-1 rounded bg-white/5 border border-white/10 text-muted hover:text-foreground"
                >
                  Email
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
