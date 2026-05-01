export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSeconds(seconds: number | null | undefined, mode: "short" | "long" = "short"): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (mode === "short") {
    if (s < 60) return `${s}s`;
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r === 0 ? `${m}m` : `${m}m ${r}s`;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  // long
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Render a delta with sign and unit. For "pp" (percentage points), `value` is
 * the absolute change in fraction-of-1 (so `0.05` renders as `+5.0pp`).
 */
export function formatDelta(value: number, unit: "pp" | "s" | "%", invert = false): string {
  if (!Number.isFinite(value) || value === 0) return "no change vs prior";
  const sign = value > 0 ? "+" : "";
  const goodDirection = invert ? value < 0 : value > 0;
  const tone = goodDirection ? "↓ improving" : "↑ worsening";
  if (unit === "pp") {
    return `${sign}${(value * 100).toFixed(1)}pp ${tone}`;
  }
  if (unit === "s") {
    return `${sign}${Math.round(value)}s ${tone}`;
  }
  return `${sign}${(value * 100).toFixed(1)}% ${tone}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
