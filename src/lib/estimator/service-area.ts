import { loadUtilityForZip } from "./data-loader";
import type { Location } from "./types";

export function resolveLocationFromZip(zip: string): Location | null {
  const trimmed = String(zip ?? "").trim().slice(0, 5);
  const utility = loadUtilityForZip(trimmed);
  if (!utility) return null;

  const z = parseInt(trimmed, 10);
  if (!Number.isFinite(z)) return null;

  if (utility.state === "CO") {
    if (z >= 80800 && z <= 80999) return "COSP";
    if (z >= 80020 && z <= 80035) return "WESTY";
    if (z >= 80300 && z <= 80305) return "WESTY";
    if (z >= 80501 && z <= 80545) return "WESTY";
    return "DTC";
  }

  if (utility.state === "CA") {
    // SCE territory → Camarillo office; PG&E → SLO/general CA.
    if (utility.id === "2477") return "CAMARILLO";
    return "CA";
  }

  return null;
}

export function isInServiceArea(zip: string): boolean {
  return resolveLocationFromZip(zip) !== null;
}
