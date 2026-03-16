export function normalizeEmail(value?: string | null): string | null {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
