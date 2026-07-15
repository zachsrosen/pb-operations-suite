/**
 * SolarEdge → HubSpot linkage.
 *
 * Most PB SolarEdge site names carry the PROJ number ("PROJ-2166 Kevin Bruer",
 * "PROJ 1230 - Rudolph 4440"), which is the clean, authoritative link to a
 * HubSpot deal (and through it, the property object). Sites without a PROJ
 * number in the name fall back to address/name matching (handled elsewhere).
 */

export interface SolarEdgeLinkResult {
  projNumber: string | null; // normalized "PROJ-1234"
}

/**
 * Extract and normalize a PROJ number from a SolarEdge site name.
 *
 * Handles the observed formats: "PROJ-2166 Kevin Bruer", "PROJ 1230 - Rudolph",
 * "PROJ-1265 Charles Baker", "SVC | PROJ-10030 | ...". Normalizes to the
 * canonical "PROJ-<digits>" form (hyphen, no spaces) used as HubSpot dealname
 * prefix. Returns null when the name carries no PROJ number.
 */
export function extractProjNumber(siteName: string | null | undefined): string | null {
  if (!siteName) return null;
  // PROJ, optional space/hyphen, then digits. Case-insensitive.
  const m = siteName.match(/\bPROJ[\s-]*0*(\d+)\b/i);
  if (!m) return null;
  return `PROJ-${m[1]}`;
}
