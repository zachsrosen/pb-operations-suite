import {
  BOM_RULES_VERSION,
  postProcessBomItems,
  type BomItem,
  type BomProject,
  type BomPostProcessResult,
} from "@/lib/bom-post-process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal BomItem. */
function bi(
  overrides: Partial<BomItem> & { category: string; description: string },
): BomItem {
  return { qty: 1, ...overrides };
}

function proj(overrides: Partial<BomProject> = {}): BomProject {
  return { ...overrides };
}

/** Run post-processor and return result. */
function run(
  items: BomItem[],
  project?: BomProject,
): BomPostProcessResult {
  return postProcessBomItems(project, items);
}

// ---------------------------------------------------------------------------
// Tests: Rule 1 — Category Standardization
// ---------------------------------------------------------------------------

describe("Rule 1: Category Standardization", () => {
  it("normalizes MOUNT → RACKING", () => {
    const r = run([bi({ category: "MOUNT", description: "Rail" })]);
    expect(r.items[0].category).toBe("RACKING");
    expect(r.corrections).toContainEqual(
      expect.objectContaining({ action: "category_fix", newValue: "RACKING" }),
    );
  });

  it("normalizes ELECTRICAL → ELECTRICAL_BOS", () => {
    const r = run([bi({ category: "ELECTRICAL", description: "Wire" })]);
    expect(r.items[0].category).toBe("ELECTRICAL_BOS");
  });

  it("normalizes STORAGE → BATTERY", () => {
    const r = run([bi({ category: "STORAGE", description: "PW3" })]);
    expect(r.items[0].category).toBe("BATTERY");
  });

  it("leaves valid categories unchanged", () => {
    const r = run([bi({ category: "MODULE", description: "Panel" })]);
    expect(r.items[0].category).toBe("MODULE");
    expect(r.corrections.filter((c) => c.action === "category_fix")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 2 — Brand Inference
// ---------------------------------------------------------------------------

describe("Rule 2: Brand Inference", () => {
  it("infers Tesla from model 1707000", () => {
    const r = run([
      bi({ category: "BATTERY", description: "Powerwall", model: "1707000-21-K" }),
    ]);
    expect(r.items[0].brand).toBe("Tesla");
  });

  it("infers IronRidge from model XR10", () => {
    const r = run([
      bi({ category: "RACKING", description: "Rail", model: "XR-10-168M" }),
    ]);
    expect(r.items[0].brand).toBe("IronRidge");
  });

  it("infers GE from model TL270RCU", () => {
    const r = run([
      bi({ category: "ELECTRICAL_BOS", description: "Load Center", model: "TL270RCU" }),
    ]);
    expect(r.items[0].brand).toBe("GE");
  });

  it("infers IMO from model SI16-PEL", () => {
    const r = run([
      bi({ category: "RAPID_SHUTDOWN", description: "RSU", model: "SI16-PEL64R-2" }),
    ]);
    expect(r.items[0].brand).toBe("IMO");
  });

  it("does not overwrite existing brand", () => {
    const r = run([
      bi({ category: "BATTERY", description: "PW3", model: "1707000-21-K", brand: "CustomBrand" }),
    ]);
    expect(r.items[0].brand).toBe("CustomBrand");
  });

  it("leaves brand empty when no pattern matches", () => {
    const r = run([
      bi({ category: "RACKING", description: "Unknown Widget", model: "XYZZY-99" }),
    ]);
    expect(r.items[0].brand).toBeUndefined();
    expect(r.corrections.filter((c) => c.action === "brand_fill")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 3 — Model Standardization
// ---------------------------------------------------------------------------

describe("Rule 3: Model Standardization", () => {
  it("standardizes 'Powerwall 3' description to model 1707000-XX-Y", () => {
    const r = run([
      bi({ category: "BATTERY", description: "Tesla Powerwall 3, 13.5kWh" }),
    ]);
    expect(r.items[0].model).toBe("1707000-XX-Y");
  });

  it("standardizes 'Backup Gateway 3' to model 1841000-X1-Y", () => {
    const r = run([
      bi({ category: "MONITORING", description: "Tesla Backup Gateway 3, 200A" }),
    ]);
    expect(r.items[0].model).toBe("1841000-X1-Y");
  });

  it("does not overwrite existing correct model number", () => {
    const r = run([
      bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-21-K" }),
    ]);
    // model already contains "1707000" prefix, should not be overwritten
    expect(r.items[0].model).toBe("1707000-21-K");
  });
});

// ---------------------------------------------------------------------------
// Tests: Job context detection runs AFTER normalization (P1 fix)
// ---------------------------------------------------------------------------

describe("Job context detection (post-normalization)", () => {
  it("detects hybrid job from PV_MODULE + STORAGE categories", () => {
    // Before the fix, PV_MODULE and STORAGE wouldn't match MODULE and BATTERY
    // in detectJobContext, resulting in battery_only instead of hybrid
    const r = run([
      bi({ category: "PV_MODULE", description: "Solar Panel", qty: 16 }),
      bi({ category: "STORAGE", description: "Tesla Powerwall 3, 13.5kWh" }),
    ]);
    // After normalization: PV_MODULE→MODULE, STORAGE→BATTERY
    expect(r.items[0].category).toBe("MODULE");
    expect(r.items[1].category).toBe("BATTERY");
    // Job context should see normalized categories
    expect(r.jobContext.jobType).toBe("hybrid");
    expect(r.jobContext.moduleCount).toBe(16);
  });

  it("detects hasPowerwall from model standardized 'Powerwall 3' description", () => {
    // Before the fix, description "Powerwall 3" without a model wouldn't set
    // hasPowerwall=true because model standardization hadn't run yet
    const r = run([
      bi({ category: "PV_MODULE", description: "Solar Panel", qty: 16 }),
      bi({ category: "STORAGE", description: "Tesla Powerwall 3, 13.5kWh" }),
    ]);
    // After model standardization, model should be "1707000-XX-Y"
    expect(r.items[1].model).toBe("1707000-XX-Y");
    expect(r.jobContext.hasPowerwall).toBe(true);
    // Should suggest TL270RCU since it's a PW3 solar job
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "TL270RCU" }),
    );
  });

  it("detects hasExpansion from model standardized 'PW3 Expansion' description", () => {
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "STORAGE", description: "Tesla Powerwall 3" }),
      bi({ category: "STORAGE", description: "Tesla Powerwall 3 Expansion" }),
    ]);
    expect(r.items[2].model).toBe("1807000-XX-Y");
    expect(r.jobContext.hasExpansion).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 4 — Quantity Corrections (informational only, no mutation)
// ---------------------------------------------------------------------------

describe("Rule 4: Quantity Corrections (informational only)", () => {
  describe("Snow Dogs", () => {
    it("records correction for 10→2 on 8-module job but does NOT mutate qty", () => {
      const r = run(
        [
          bi({ category: "MODULE", description: "Panel", qty: 8 }),
          bi({ category: "RACKING", description: "Snow Dog", qty: 10 }),
        ],
        proj({ moduleCount: 8 }),
      );
      const snowDog = r.items.find((i) => /snow\s*dog/i.test(i.description));
      // qty should remain original (NOT mutated)
      expect(snowDog?.qty).toBe(10);
      // correction should record the suggested adjustment
      const qtyCorrections = r.corrections.filter(
        (c) => c.action === "qty_adjust" && /snow/i.test(c.description),
      );
      expect(qtyCorrections).toHaveLength(1);
      expect(qtyCorrections[0].oldValue).toBe(10);
      expect(qtyCorrections[0].newValue).toBe(2);
    });

    it("records correction for 13-module job (target 6)", () => {
      const r = run(
        [
          bi({ category: "MODULE", description: "Panel", qty: 13 }),
          bi({ category: "RACKING", description: "Snow Dog", qty: 10 }),
        ],
        proj({ moduleCount: 13 }),
      );
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /snow/i.test(c.description),
      );
      expect(qtyCorrection?.oldValue).toBe(10);
      expect(qtyCorrection?.newValue).toBe(6);
      // qty NOT mutated
      expect(r.items.find((i) => /snow\s*dog/i.test(i.description))?.qty).toBe(10);
    });

    it("records correction for 27-module job (target 10)", () => {
      const r = run(
        [
          bi({ category: "MODULE", description: "Panel", qty: 27 }),
          bi({ category: "RACKING", description: "Snow Dog", qty: 4 }),
        ],
        proj({ moduleCount: 27 }),
      );
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /snow/i.test(c.description),
      );
      expect(qtyCorrection?.oldValue).toBe(4);
      expect(qtyCorrection?.newValue).toBe(10);
    });

    it("does not record correction if already correct", () => {
      const r = run(
        [
          bi({ category: "MODULE", description: "Panel", qty: 8 }),
          bi({ category: "RACKING", description: "Snow Dog", qty: 2 }),
        ],
        proj({ moduleCount: 8 }),
      );
      expect(r.corrections.filter((c) => c.action === "qty_adjust" && /snow/i.test(c.description))).toHaveLength(0);
    });
  });

  describe("Standing seam snow dogs (P2 fix)", () => {
    it("records correction with target=0 for standing seam roof", () => {
      const r = run(
        [
          bi({ category: "MODULE", description: "Panel", qty: 16 }),
          bi({ category: "RACKING", description: "S-5! U-Clamp" }),
          bi({ category: "RACKING", description: "Snow Dog", qty: 4 }),
        ],
        proj({ roofType: "standing seam", moduleCount: 16 }),
      );
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /snow/i.test(c.description),
      );
      expect(qtyCorrection).toBeDefined();
      expect(qtyCorrection?.oldValue).toBe(4);
      expect(qtyCorrection?.newValue).toBe(0);
      expect(qtyCorrection?.reason).toContain("standing seam");
      // qty NOT mutated
      expect(r.items.find((i) => /snow\s*dog/i.test(i.description))?.qty).toBe(4);
    });
  });

  describe("Critter Guard", () => {
    it("records correction for ≤10-module job (target 1) but does NOT mutate", () => {
      const r = run(
        [bi({ category: "RACKING", description: "Critter Guard 6\" Roll", qty: 4 })],
        proj({ moduleCount: 8 }),
      );
      expect(r.items[0].qty).toBe(4); // NOT mutated
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /critter/i.test(c.description),
      );
      expect(qtyCorrection?.newValue).toBe(1);
    });

    it("records correction for 15-module job (target 2)", () => {
      const r = run(
        [bi({ category: "RACKING", description: "Critter Guard", qty: 4 })],
        proj({ moduleCount: 15 }),
      );
      expect(r.items[0].qty).toBe(4); // NOT mutated
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /critter/i.test(c.description),
      );
      expect(qtyCorrection?.newValue).toBe(2);
    });
  });

  describe("RD Structural Screws", () => {
    it("records correction to 120 for ≤25 modules", () => {
      const r = run(
        [bi({ category: "RACKING", description: "RD Structural Screw HW-RD1430-01-M1", qty: 48 })],
        proj({ moduleCount: 16 }),
      );
      expect(r.items[0].qty).toBe(48); // NOT mutated
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /rd/i.test(c.description),
      );
      expect(qtyCorrection?.newValue).toBe(120);
    });

    it("records correction to 240 for >25 modules", () => {
      const r = run(
        [bi({ category: "RACKING", description: "RD Structural Screw", qty: 48 })],
        proj({ moduleCount: 27 }),
      );
      expect(r.items[0].qty).toBe(48); // NOT mutated
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /rd/i.test(c.description),
      );
      expect(qtyCorrection?.newValue).toBe(240);
    });
  });

  describe("Strain Relief", () => {
    it("records correction to 2 for ≤25 modules", () => {
      const r = run(
        [bi({ category: "ELECTRICAL_BOS", description: "Strain Relief M3317GBZ", qty: 5 })],
        proj({ moduleCount: 16 }),
      );
      expect(r.items[0].qty).toBe(5); // NOT mutated
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /strain/i.test(c.description),
      );
      expect(qtyCorrection?.newValue).toBe(2);
    });

    it("records correction to 3 for >25 modules", () => {
      const r = run(
        [bi({ category: "ELECTRICAL_BOS", description: "Strain Relief M3317GBZ", qty: 5 })],
        proj({ moduleCount: 27 }),
      );
      expect(r.items[0].qty).toBe(5); // NOT mutated
      const qtyCorrection = r.corrections.find(
        (c) => c.action === "qty_adjust" && /strain/i.test(c.description),
      );
      expect(qtyCorrection?.newValue).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 5 — Suggested Additions
// ---------------------------------------------------------------------------

describe("Rule 5: Suggested Additions", () => {
  it("suggests TL270RCU + THQL2160 for PW3 solar jobs", () => {
    const r = run(
      [
        bi({ category: "MODULE", description: "Solar Panel", qty: 16 }),
        bi({ category: "BATTERY", description: "Tesla PW3", model: "1707000-21-K" }),
      ],
      proj({ moduleCount: 16 }),
    );
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "TL270RCU", source: "OPS_STANDARD" }),
    );
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "THQL2160", source: "OPS_STANDARD" }),
    );
  });

  it("does NOT suggest TL270RCU for battery-only jobs", () => {
    const r = run([
      bi({ category: "BATTERY", description: "Tesla PW3", model: "1707000-21-K" }),
    ]);
    expect(r.suggestedAdditions.find((i) => i.model === "TL270RCU")).toBeUndefined();
    expect(r.suggestedAdditions.find((i) => i.model === "THQL2160")).toBeUndefined();
  });

  it("suggests expansion wall mount kit + harness for expansion jobs", () => {
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "BATTERY", description: "PW3", model: "1707000-21-K" }),
      bi({ category: "BATTERY", description: "PW3 Expansion", model: "1807000-20-B" }),
    ]);
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "1978069-00-x" }),
    );
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "1875157-20-y" }),
    );
  });

  it("suggests stacking kit (not wall mount) for stacked expansion", () => {
    // isStackedExpansion requires >2 total PW3+Expansion units
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "BATTERY", description: "PW3", model: "1707000-21-K" }),
      bi({ category: "BATTERY", description: "PW3 Expansion", model: "1807000-20-B" }),
      bi({ category: "BATTERY", description: "PW3 Expansion #2", model: "1807000-20-B" }),
    ]);
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "1978070-00-x" }),
    );
    expect(r.suggestedAdditions.find((i) => i.model === "1978069-00-x")).toBeUndefined();
  });

  it("suggests fuses for fused disconnect service tap", () => {
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "ELECTRICAL_BOS", description: "AC Disconnect DG222NRB Fusible" }),
    ]);
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "46201" }),
    );
  });

  it("suggests tile hooks + T-bolt + JB-2 for tile roof jobs", () => {
    const r = run(
      [
        bi({ category: "MODULE", description: "Panel", qty: 12 }),
        bi({ category: "RACKING", description: "Tile Hook ATH-01-M1", model: "ATH-01-M1" }),
      ],
      proj({ roofType: "tile", moduleCount: 12 }),
    );
    // ATH-01-M1 is already in items, so should NOT be in suggestions
    expect(r.suggestedAdditions.find((i) => i.model === "ATH-01-M1")).toBeUndefined();
    // T-bolt and JB-2 should be suggested
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "BHW-TB-03-A1" }),
    );
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "JB-2" }),
    );
  });

  it("suggests L-Foot for standing seam S-5! jobs", () => {
    const r = run(
      [
        bi({ category: "MODULE", description: "Panel", qty: 20 }),
        bi({ category: "RACKING", description: "S-5! U-Clamp", model: "S-5-U" }),
      ],
      proj({ roofType: "standing seam", moduleCount: 20 }),
    );
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "LFT-03-M1", qty: 60 }),
    );
  });

  it("suggests IMO RSU when missing from solar job", () => {
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "RAPID_SHUTDOWN", description: "Tesla MCI-2", model: "MCI-2" }),
    ]);
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "SI16-PEL64R-2" }),
    );
  });

  it("does NOT suggest IMO RSU if already present", () => {
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "RAPID_SHUTDOWN", description: "IMO SI16-PEL64R-2", model: "SI16-PEL64R-2" }),
    ]);
    expect(r.suggestedAdditions.find((i) => i.model === "SI16-PEL64R-2")).toBeUndefined();
  });

  it("does not duplicate items already in suggestions", () => {
    // Two PW3s shouldn't double-add TL270RCU
    const r = run([
      bi({ category: "MODULE", description: "Panel", qty: 16 }),
      bi({ category: "BATTERY", description: "PW3", model: "1707000-21-K" }),
      bi({ category: "BATTERY", description: "PW3 #2", model: "1707000-21-K" }),
    ]);
    const tl270 = r.suggestedAdditions.filter((i) => i.model === "TL270RCU");
    expect(tl270).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Deep copy safety
// ---------------------------------------------------------------------------

describe("Deep copy safety", () => {
  it("does not mutate the original items array", () => {
    const original = [
      bi({ category: "MOUNT", description: "Rail", brand: null, qty: 10 }),
    ];
    const originalCopy = JSON.parse(JSON.stringify(original));
    run(original);
    expect(original).toEqual(originalCopy);
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration — full pipeline
// ---------------------------------------------------------------------------

describe("Integration", () => {
  it("processes a typical PW3 solar job end-to-end", () => {
    const r = run(
      [
        bi({ category: "MODULE", description: "Hyundai HiN-T440NF(BK)", qty: 16 }),
        bi({ category: "BATTERY", description: "Tesla PW3", model: "1707000-21-K" }),
        bi({ category: "RAPID_SHUTDOWN", description: "Tesla MCI-2 High Current", model: "1879359-15-B", qty: 10 }),
        bi({ category: "RACKING", description: "IronRidge XR10 Rail 168\"", model: "XR-10-168M", brand: "IronRidge", qty: 8 }),
        bi({ category: "RACKING", description: "Snow Dog", qty: 10 }),
        bi({ category: "RACKING", description: "Critter Guard 6\" Roll", qty: 4 }),
        bi({ category: "RACKING", description: "Heyco SunScreener Clip", qty: 4 }),
        bi({ category: "ELECTRICAL_BOS", description: "Strain Relief M3317GBZ", qty: 5 }),
        bi({ category: "RACKING", description: "RD Structural Screw HW-RD1430-01-M1", qty: 48 }),
        bi({ category: "ELECTRICAL_BOS", description: "UNIRAC SOLOBOX COMP-D", qty: 4 }),
      ],
      proj({ moduleCount: 16 }),
    );

    // Qty corrections are informational — items keep original qty
    expect(r.items.find((i) => /snow\s*dog/i.test(i.description))?.qty).toBe(10);
    expect(r.items.find((i) => /critter/i.test(i.description))?.qty).toBe(4);
    expect(r.items.find((i) => /sunscreener/i.test(i.description))?.qty).toBe(4);
    expect(r.items.find((i) => /strain/i.test(i.description))?.qty).toBe(5);
    expect(r.items.find((i) => /rd\s*structural/i.test(i.description))?.qty).toBe(48);
    expect(r.items.find((i) => /solobox/i.test(i.description))?.qty).toBe(4);

    // Corrections should still record the suggested adjustments
    const qtyCorrections = r.corrections.filter((c) => c.action === "qty_adjust");
    expect(qtyCorrections.length).toBeGreaterThanOrEqual(5);

    // Brand should be inferred for PW3
    expect(r.items.find((i) => /pw3/i.test(i.description))?.brand).toBe("Tesla");

    // Suggested additions should include OPS_STANDARD
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "TL270RCU" }),
    );
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "THQL2160" }),
    );
    // IMO RSU should be suggested (not in items)
    expect(r.suggestedAdditions).toContainEqual(
      expect.objectContaining({ model: "SI16-PEL64R-2" }),
    );

    // rulesVersion
    expect(r.rulesVersion).toBe(BOM_RULES_VERSION);

    // Job context
    expect(r.jobContext.jobType).toBe("hybrid");
    expect(r.jobContext.hasPowerwall).toBe(true);
    expect(r.jobContext.moduleCount).toBe(16);
  });

  it("processes a battery-only job correctly", () => {
    const r = run([
      bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-21-K" }),
      bi({ category: "BATTERY", description: "Backup Switch", model: "1624171-00-x" }),
    ]);

    expect(r.jobContext.jobType).toBe("battery_only");
    expect(r.jobContext.hasBackupSwitch).toBe(true);

    // No TL270RCU/THQL2160 suggested
    expect(r.suggestedAdditions.find((i) => i.model === "TL270RCU")).toBeUndefined();

    // No IMO RSU suggested (battery-only)
    expect(r.suggestedAdditions.find((i) => i.model === "SI16-PEL64R-2")).toBeUndefined();
  });

  it("all corrections have required fields", () => {
    const r = run(
      [
        bi({ category: "MOUNT", description: "Rail", qty: 1 }),
        bi({ category: "MODULE", description: "Panel", qty: 16 }),
        bi({ category: "BATTERY", description: "PW3", model: "1707000-21-K" }),
      ],
      proj({ moduleCount: 16 }),
    );

    for (const c of r.corrections) {
      expect(c.action).toBeDefined();
      expect(c.description).toBeDefined();
      expect(c.reason).toBeDefined();
    }
  });
});
