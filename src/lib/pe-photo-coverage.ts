/**
 * Pure coverage logic for the PE Photos-per-Policy package. No I/O.
 * `requiredShotsFor` derives from PE_M1_CHECKLIST.appliesTo (single source of
 * truth); the Sales Order (invoice_bom slot) is tracked separately via soFound.
 */
import { PE_M1_CHECKLIST, type SystemType } from "@/lib/pe-turnover";

export interface RequiredShot { id: string; label: string; pePhotoNumber?: number; }
export type ShotStatus = "covered" | "recheck" | "missing";
export interface ShotCoverage extends RequiredShot { status: ShotStatus; count: number; }
export interface CoverageReport {
  systemType: SystemType;
  shots: ShotCoverage[];
  salesOrder: "covered" | "missing";
  bonus: RequiredShot[];
  complete: boolean;
}

const SO_SHOT_ID = "m1.photos.6_invoice_bom";

export function requiredShotsFor(systemType: SystemType): RequiredShot[] {
  return PE_M1_CHECKLIST
    .filter((i) => i.isPhoto && i.id !== SO_SHOT_ID && i.appliesTo.includes(systemType))
    .map((i) => ({ id: i.id, label: i.label, pePhotoNumber: i.pePhotoNumber }));
}

export interface Assignment { checklistId: string; verdict: "pass" | "fail" | "needs_review"; }

export function computeCoverage(
  assignments: Assignment[],
  systemType: SystemType,
  soFound: boolean,
): CoverageReport {
  const required = requiredShotsFor(systemType);
  const requiredIds = new Set(required.map((s) => s.id));
  const byShot = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (a.verdict === "fail") continue;
    if (!byShot.has(a.checklistId)) byShot.set(a.checklistId, []);
    byShot.get(a.checklistId)!.push(a);
  }
  const shots: ShotCoverage[] = required.map((s) => {
    const matched = byShot.get(s.id) ?? [];
    const status: ShotStatus = matched.length === 0
      ? "missing"
      : matched.some((a) => a.verdict === "pass") ? "covered" : "recheck";
    return { ...s, status, count: matched.length };
  });
  const photoShotIds = new Set(PE_M1_CHECKLIST.filter((i) => i.isPhoto && i.id !== SO_SHOT_ID).map((i) => i.id));
  const labelById = new Map(PE_M1_CHECKLIST.map((i) => [i.id, i.label]));
  const numById = new Map(PE_M1_CHECKLIST.map((i) => [i.id, i.pePhotoNumber]));
  const bonus: RequiredShot[] = [...byShot.keys()]
    .filter((id) => photoShotIds.has(id) && !requiredIds.has(id))
    .map((id) => ({ id, label: labelById.get(id) ?? id, pePhotoNumber: numById.get(id) }));
  const salesOrder = soFound ? "covered" : "missing";
  // `complete` = every required slot has at least one photo AND the SO is present.
  // A "recheck" shot counts as present (it has a photo, just flagged for human
  // verification), so it does NOT block completeness — only a truly-missing slot does.
  const complete = shots.every((s) => s.status !== "missing") && soFound;
  return { systemType, shots, salesOrder, bonus, complete };
}
