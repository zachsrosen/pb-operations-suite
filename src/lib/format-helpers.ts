export function fmtAmount(v: number | null | undefined): string {
  if (v === null || v === undefined) return "--";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
