/**
 * Tests for src/lib/pe-photo-coverage.ts
 *
 * pe-turnover is mocked (with corrected appliesTo for shots 4 + 5 = ALL)
 * to avoid the Prisma/Zuper import chain in Jest.
 */

jest.mock("@/lib/pe-turnover", () => {
  const ALL = ["solar", "battery", "solar+battery"];
  const SOLAR = ["solar", "solar+battery"];
  const STORAGE = ["battery", "solar+battery"];
  const PE_M1_CHECKLIST = [
    { id: "m1.photos.1_site_address", label: "Site address + home", isPhoto: true, appliesTo: ALL, pePhotoNumber: 1 },
    { id: "m1.photos.2_pv_array", label: "Wide-angle PV array", isPhoto: true, appliesTo: SOLAR, pePhotoNumber: 2 },
    { id: "m1.photos.3_module_nameplate", label: "Module nameplate label", isPhoto: true, appliesTo: SOLAR, pePhotoNumber: 3 },
    { id: "m1.photos.4_electrical", label: "Wide-angle all electrical", isPhoto: true, appliesTo: ALL, pePhotoNumber: 4 },
    { id: "m1.photos.5_msp", label: "Main service panel (cover off)", isPhoto: true, appliesTo: ALL, pePhotoNumber: 5 },
    { id: "m1.photos.6_invoice_bom", label: "Invoice & BOM", isPhoto: true, appliesTo: ALL, pePhotoNumber: 6 },
    { id: "m1.photos.7_inverter", label: "Inverter/micro/optimizer model", isPhoto: true, appliesTo: SOLAR, pePhotoNumber: 7 },
    { id: "m1.photos.8_racking", label: "Racking parts + markings", isPhoto: true, appliesTo: SOLAR, pePhotoNumber: 8 },
    { id: "m1.photos.9_storage_wide", label: "Storage wide angle", isPhoto: true, appliesTo: STORAGE, pePhotoNumber: 9 },
    { id: "m1.photos.10_storage_nameplate", label: "Storage nameplate & labels", isPhoto: true, appliesTo: STORAGE, pePhotoNumber: 10 },
    { id: "m1.photos.11_storage_controller", label: "Storage controller/disconnect", isPhoto: true, appliesTo: STORAGE, pePhotoNumber: 11 },
  ];
  return { PE_M1_CHECKLIST };
});

import { requiredShotsFor, computeCoverage } from "@/lib/pe-photo-coverage";

describe("requiredShotsFor", () => {
  it("solar = site, pv, module, electrical, msp, inverter, racking (no SO, no storage)", () => {
    expect(requiredShotsFor("solar").map((s) => s.id)).toEqual([
      "m1.photos.1_site_address", "m1.photos.2_pv_array", "m1.photos.3_module_nameplate",
      "m1.photos.4_electrical", "m1.photos.5_msp", "m1.photos.7_inverter", "m1.photos.8_racking",
    ]);
  });
  it("battery = site, electrical, msp, storage wide/nameplate/controller (no solar shots)", () => {
    expect(requiredShotsFor("battery").map((s) => s.id)).toEqual([
      "m1.photos.1_site_address", "m1.photos.4_electrical", "m1.photos.5_msp",
      "m1.photos.9_storage_wide", "m1.photos.10_storage_nameplate", "m1.photos.11_storage_controller",
    ]);
  });
  it("solar+battery = union of both, full ordered list", () => {
    expect(requiredShotsFor("solar+battery").map((s) => s.id)).toEqual([
      "m1.photos.1_site_address", "m1.photos.2_pv_array", "m1.photos.3_module_nameplate",
      "m1.photos.4_electrical", "m1.photos.5_msp", "m1.photos.7_inverter", "m1.photos.8_racking",
      "m1.photos.9_storage_wide", "m1.photos.10_storage_nameplate", "m1.photos.11_storage_controller",
    ]);
  });
  it("excludes the invoice_bom shot from photo shots (tracked separately as SO)", () => {
    expect(requiredShotsFor("battery").map((s) => s.id)).not.toContain("m1.photos.6_invoice_bom");
  });
});

describe("computeCoverage", () => {
  const A = (checklistId: string, verdict: "pass" | "fail" | "needs_review" = "pass") => ({
    checklistId,
    verdict,
    issues: [],
    equipmentVisible: [],
  });

  it("marks a shot covered when it has a pass", () => {
    const r = computeCoverage([A("m1.photos.1_site_address")], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.1_site_address")!.status).toBe("covered");
  });
  it("marks a shot recheck when only needs_review", () => {
    const r = computeCoverage([A("m1.photos.4_electrical", "needs_review")], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.4_electrical")!.status).toBe("recheck");
  });
  it("marks a shot missing when no photo assigned", () => {
    const r = computeCoverage([], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.5_msp")!.status).toBe("missing");
  });
  it("ignores fail-verdict photos for coverage", () => {
    const r = computeCoverage([A("m1.photos.5_msp", "fail")], "battery", true);
    expect(r.shots.find((s) => s.id === "m1.photos.5_msp")!.status).toBe("missing");
  });
  it("SO row reflects soFound", () => {
    expect(computeCoverage([], "battery", true).salesOrder).toBe("covered");
    expect(computeCoverage([], "battery", false).salesOrder).toBe("missing");
  });
  it("lists non-required matched shots as bonus", () => {
    const r = computeCoverage([A("m1.photos.2_pv_array")], "battery", true);
    expect(r.bonus.map((b) => b.id)).toContain("m1.photos.2_pv_array");
  });
  it("complete flag true only when no missing required shots and SO present", () => {
    const full = requiredShotsFor("battery").map((s) => A(s.id));
    expect(computeCoverage(full, "battery", true).complete).toBe(true);
    expect(computeCoverage(full, "battery", false).complete).toBe(false);
  });
  it("a recheck shot does NOT block complete (it has a photo, just flagged)", () => {
    // battery requires: site, electrical, msp, storage wide/nameplate/controller
    const reqs = requiredShotsFor("battery");
    const assignments = reqs.map((s, i) =>
      A(s.id, i === 0 ? "needs_review" : "pass")); // one recheck, rest pass
    const r = computeCoverage(assignments, "battery", true);
    expect(r.shots.find((s) => s.id === reqs[0].id)!.status).toBe("recheck");
    expect(r.complete).toBe(true);
  });
});
