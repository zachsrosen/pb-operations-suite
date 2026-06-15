// Shared uploader display helpers — name formatting + per-person colors.
// Extracted so both AnalyticsTab and the rework section can use them without a
// circular import.

import { UNKNOWN_UPLOADER } from "@/lib/pe-analytics";

/** "lauren.soderholm@photonbrothers.com" → "Lauren Soderholm" */
export function prettyUploader(email: string): string {
  if (email === UNKNOWN_UPLOADER) return email;
  const local = email.split("@")[0];
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

/** Distinct colors per person for stacked bars; Unknown = zinc. */
export const PERSON_COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb923c", "#60a5fa", "#f87171", "#c084fc", "#2dd4bf"];

export function buildColorMap(orderedPeople: string[]): Map<string, string> {
  const m = new Map<string, string>();
  orderedPeople.forEach((u, i) => m.set(u, PERSON_COLORS[i % PERSON_COLORS.length]));
  m.set(UNKNOWN_UPLOADER, "#71717a");
  return m;
}
