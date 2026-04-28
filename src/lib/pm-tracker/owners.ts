/**
 * PM team identity + name normalization.
 *
 * The HubSpot `project_manager` deal property is a free-text string, so PMs
 * may appear with different spellings across deals. This module canonicalizes
 * those variants to a fixed set of names.
 *
 * FLAG (open question): `Kaitlyn` and `Katlyyn` are treated as the same person
 * by default. If they are actually two distinct PMs, split the alias map
 * and add `"Katlyyn"` to PM_NAMES.
 */

export const PM_NAMES = ["Natasha", "Alexis", "Kaitlyn"] as const;
export type PmName = (typeof PM_NAMES)[number];

const ALIAS_MAP: Record<string, PmName> = {
  natasha: "Natasha",
  alexis: "Alexis",
  kaitlyn: "Kaitlyn",
  katlyyn: "Kaitlyn", // typo variant — assumed same person
  katelyn: "Kaitlyn",
  katelynn: "Kaitlyn",
};

export function normalizePmName(raw: string | null | undefined): PmName | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ALIAS_MAP[key] ?? null;
}

export function isPmName(raw: string | null | undefined): boolean {
  return normalizePmName(raw) !== null;
}

/**
 * SQL-friendly variant matcher. Returns the list of raw spellings that map
 * to the given canonical name — useful for `WHERE projectManager IN (...)`
 * queries.
 */
export function rawNamesFor(pmName: PmName): string[] {
  return Object.entries(ALIAS_MAP)
    .filter(([, canonical]) => canonical === pmName)
    .map(([raw]) => raw);
}
