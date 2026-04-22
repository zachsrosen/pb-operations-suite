"use client";

type Pool = {
  poolId: string;
  poolName: string;
  region: string;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
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

function formatShiftWindow(start: string, end: string, tz: string): string {
  const tzAbbr = tz.includes("Los_Angeles") ? "PT" : "MT";
  const fmt = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const suffix = h >= 12 ? "pm" : "am";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}${m > 0 ? `:${m}` : ""}${suffix}`;
  };
  return `${fmt(start)} → ${fmt(end)} ${tzAbbr}`;
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
                <span className="text-muted italic">Schedule starts May 4</span>
              ) : (
                p.crewMember?.name ?? <span className="text-muted italic">Unassigned</span>
              )}
            </div>
            <div className="text-xs text-muted mb-4">
              {formatShiftWindow(p.shiftStart, p.shiftEnd, p.timezone)}
            </div>
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
