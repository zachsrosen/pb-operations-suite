import type { Location } from "./types";
import serviceAreaData from "./data/service-area.json";

type ServiceAreaMap = Record<string, { location: Location }>;
const MAP = serviceAreaData as ServiceAreaMap;

export function resolveLocationFromZip(zip: string): Location | null {
  const trimmed = String(zip ?? "").trim().slice(0, 5);
  return MAP[trimmed]?.location ?? null;
}

export function isInServiceArea(zip: string): boolean {
  return resolveLocationFromZip(zip) !== null;
}
