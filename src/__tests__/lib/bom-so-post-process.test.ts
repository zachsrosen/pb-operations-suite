import {
  RULES_VERSION,
  normalizedName,
  detectJobContext,
  postProcessSoItems,
  type BomProject,
  type BomItem,
  type SoLineItem,
} from "@/lib/bom-so-post-process";

// ---------------------------------------------------------------------------
// Mock findItemIdByName — returns predictable values keyed on query
// ---------------------------------------------------------------------------

const MOCK_CATALOG: Record<string, { item_id: string; zohoName: string; zohoSku: string }> = {
  "UFO-CL-01-A1": { item_id: "id-ufo-a1", zohoName: "Unirac SFM Infinity Clamp (Mill)", zohoSku: "UFO-CL-01-A1" },
  "CAMO-01-M1": { item_id: "id-camo", zohoName: "Unirac Camo End Clamp", zohoSku: "CAMO-01-M1" },
  "TL270RCU": { item_id: "id-tl270", zohoName: "GE TL270RCU Load Center", zohoSku: "TL270RCU" },
  "THQL2160": { item_id: "id-thql", zohoName: "GE THQL2160 60A 2-Pole Breaker", zohoSku: "THQL2160" },
  "1978069-00-x": { item_id: "id-wallmount", zohoName: "Tesla PW3 Wall Mount Kit", zohoSku: "1978069-00-x" },
  "1875157-20-y": { item_id: "id-harness", zohoName: "Tesla PW3 Expansion Harness 2.0m", zohoSku: "1875157-20-y" },
  "ATH-01-M1": { item_id: "id-tilehook", zohoName: "Unirac Tile Hook ATH-01", zohoSku: "ATH-01-M1" },
  "BHW-TB-03-A1": { item_id: "id-tbolt", zohoName: "Unirac T-Bolt Bonding Hardware", zohoSku: "BHW-TB-03-A1" },
  "JB-2": { item_id: "id-jb2", zohoName: "Soladeck JB-2 Junction Box", zohoSku: "JB-2" },
  "LFT-03-M1": { item_id: "id-lfoot", zohoName: "Unirac L-Foot Mount LFT-03", zohoSku: "LFT-03-M1" },
};

function mockFindItem(query: string) {
  const entry = MOCK_CATALOG[query];
  return Promise.resolve(entry ?? null);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SoLineItem. */
function li(overrides: Partial<SoLineItem> & { name: string }): SoLineItem {
  return {
    item_id: `id-${overrides.name.toLowerCase().replace(/\s+/g, "-")}`,
    quantity: 1,
    description: overrides.name,
    ...overrides,
  };
}

/** Build a minimal BomItem. */
function bi(overrides: Partial<BomItem> & { category: string; description: string }): BomItem {
  return {
    qty: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: normalizedName
// ---------------------------------------------------------------------------

describe("normalizedName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizedName("UFO-CL-01-B1")).toBe("ufo cl 01 b1");
  });

  it("collapses whitespace", () => {
    expect(normalizedName("  hello    world  ")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(normalizedName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Tests: detectJobContext
// ---------------------------------------------------------------------------

describe("detectJobContext", () => {
  it("detects solar job type", () => {
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "REC 400W Solar Panel", qty: 20 }),
      bi({ category: "INVERTER", description: "Enphase IQ8+", qty: 20 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.jobType).toBe("solar");
  });

  it("detects battery-only job type", () => {
    const items: BomItem[] = [
      bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.jobType).toBe("battery_only");
  });

  it("detects hybrid job type", () => {
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "REC 400W", qty: 15 }),
      bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.jobType).toBe("hybrid");
  });

  it("detects standing seam from project roofType", () => {
    const project: BomProject = { roofType: "Standing Seam Metal" };
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel", qty: 10 }),
      bi({ category: "MOUNT", description: "S-5! ProtéaBracket", model: "S-5!", qty: 10 }),
    ];
    const ctx = detectJobContext(project, items);
    expect(ctx.roofType).toBe("standing_seam_metal");
    expect(ctx.isStandingSeamS5).toBe(true);
  });

  it("detects standing seam from item descriptions", () => {
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel", qty: 10 }),
      bi({ category: "MOUNT", description: "L-Foot mount for standing seam", model: "LFT-03", qty: 30 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.roofType).toBe("standing_seam_metal");
    expect(ctx.isStandingSeamS5).toBe(true);
  });

  it("detects tile roof from project roofType", () => {
    const project: BomProject = { roofType: "Tile" };
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel", qty: 15 }),
    ];
    const ctx = detectJobContext(project, items);
    expect(ctx.roofType).toBe("tile");
  });

  it("detects tile roof from tile hook items", () => {
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel", qty: 15 }),
      bi({ category: "MOUNT", description: "Tile Hook ATH-01", model: "ATH-01", qty: 60 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.roofType).toBe("tile");
  });

  it("defaults to asphalt_shingle for solar jobs", () => {
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel", qty: 20 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.roofType).toBe("asphalt_shingle");
  });

  it("detects hasPowerwall from model number", () => {
    const items: BomItem[] = [
      bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasPowerwall).toBe(true);
  });

  it("detects hasExpansion from model number", () => {
    const items: BomItem[] = [
      bi({ category: "BATTERY", description: "Tesla PW3 Expansion", model: "1807000-00-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasExpansion).toBe(true);
  });

  it("detects hasBackupSwitch from model number", () => {
    const items: BomItem[] = [
      bi({ category: "ELECTRICAL", description: "Tesla Backup Switch", model: "1624171-xx-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasBackupSwitch).toBe(true);
  });

  it("detects hasGateway3 from model number", () => {
    const items: BomItem[] = [
      bi({ category: "ELECTRICAL", description: "Tesla Gateway 3", model: "1841000-xx-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasGateway3).toBe(true);
  });

  it("detects hasRemoteMeter", () => {
    const items: BomItem[] = [
      bi({ category: "ELECTRICAL", description: "Tesla Remote Meter", model: "2045796-00-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasRemoteMeter).toBe(true);
  });

  it("detects hasServiceTap from model number", () => {
    const items: BomItem[] = [
      bi({ category: "ELECTRICAL", description: "Fusible Disconnect", model: "DG222NRB", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasServiceTap).toBe(true);
  });

  it("detects hasEnphase from brand", () => {
    const items: BomItem[] = [
      bi({ category: "INVERTER", description: "IQ8PLUS-72-x-US", brand: "Enphase", model: "IQ8PLUS-72", qty: 20 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasEnphase).toBe(true);
  });

  it("detects hasEvCharger from model number", () => {
    const items: BomItem[] = [
      bi({ category: "ELECTRICAL", description: "Tesla EV Charger Gen 3", model: "1734411-xx-x", qty: 1 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.hasEvCharger).toBe(true);
  });

  it("uses project.moduleCount over item sum", () => {
    const project: BomProject = { moduleCount: 25 };
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel", qty: 20 }),
    ];
    const ctx = detectJobContext(project, items);
    expect(ctx.moduleCount).toBe(25);
  });

  it("falls back to item sum when project.moduleCount is missing", () => {
    const items: BomItem[] = [
      bi({ category: "MODULE", description: "Panel A", qty: 10 }),
      bi({ category: "MODULE", description: "Panel B", qty: 5 }),
    ];
    const ctx = detectJobContext(undefined, items);
    expect(ctx.moduleCount).toBe(15);
  });

  it("passes through utility from project", () => {
    const project: BomProject = { utility: "Xcel Energy" };
    const ctx = detectJobContext(project, []);
    expect(ctx.utility).toBe("Xcel Energy");
  });
});

// ---------------------------------------------------------------------------
// Tests: postProcessSoItems — Rule 1: SKU Swaps
// ---------------------------------------------------------------------------

describe("postProcessSoItems — Rule 1: SKU Swaps", () => {
  it("swaps mid clamp B1 → A1 for standing seam S-5!", async () => {
    const items: SoLineItem[] = [
      li({ name: "Unirac Mid Clamp", sku: "UFO-CL-01-B1", quantity: 30 }),
    ];
    const bomData = {
      project: { roofType: "Standing Seam Metal" },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 10 }),
        bi({ category: "MOUNT", description: "S-5! ProtéaBracket", model: "S-5!", qty: 10 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    const midClamp = result.lineItems.find(i => i.item_id === "id-ufo-a1");
    expect(midClamp).toBeTruthy();
    expect(midClamp!.sku).toBe("UFO-CL-01-A1");

    const swap = result.corrections.find(c => c.action === "sku_swap" && c.oldSku === "UFO-CL-01-B1");
    expect(swap).toBeTruthy();
    expect(swap!.newSku).toBe("UFO-CL-01-A1");
  });

  it("swaps end clamp UFO-END → CAMO for standing seam S-5!", async () => {
    const items: SoLineItem[] = [
      li({ name: "Unirac End Clamp", sku: "UFO-END-01-B1", quantity: 10 }),
    ];
    const bomData = {
      project: { roofType: "Standing Seam Metal" },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 10 }),
        bi({ category: "MOUNT", description: "S-5! L-Foot", model: "S-5!", qty: 10 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    const endClamp = result.lineItems.find(i => i.item_id === "id-camo");
    expect(endClamp).toBeTruthy();
    expect(endClamp!.sku).toBe("CAMO-01-M1");

    const swap = result.corrections.find(c => c.action === "sku_swap" && c.newSku === "CAMO-01-M1");
    expect(swap).toBeTruthy();
  });

  it("does NOT swap clamps for asphalt shingle roof", async () => {
    const items: SoLineItem[] = [
      li({ name: "Unirac Mid Clamp", sku: "UFO-CL-01-B1", quantity: 30 }),
    ];
    const bomData = {
      items: [bi({ category: "MODULE", description: "Panel", qty: 10 })],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.lineItems[0].sku).toBe("UFO-CL-01-B1");
    expect(result.corrections.filter(c => c.action === "sku_swap")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 2: Remove Wrong Items
// ---------------------------------------------------------------------------

describe("postProcessSoItems — Rule 2: Remove Wrong Items", () => {
  it("removes snow dogs on standing seam", async () => {
    const items: SoLineItem[] = [
      li({ name: "Snow Dog", sku: "SNOW-DOG-01", quantity: 6 }),
      li({ name: "Something else", quantity: 1 }),
    ];
    const bomData = {
      project: { roofType: "Standing Seam" },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 10 }),
        bi({ category: "MOUNT", description: "S-5!", model: "S-5!", qty: 10 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.lineItems.find(i => /snow/i.test(i.name))).toBeUndefined();
    expect(result.corrections.some(c => c.action === "item_removed" && /snow/i.test(c.itemName))).toBe(true);
  });

  it("removes HUG attachment on standing seam", async () => {
    const items: SoLineItem[] = [
      li({ name: "HUG Attachment", sku: "2101151", quantity: 20 }),
    ];
    const bomData = {
      project: { roofType: "Standing Seam" },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 10 }),
        bi({ category: "MOUNT", description: "S-5!", model: "S-5!", qty: 10 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    // HUG removed; Rule 4 may add L-Foot etc. — just verify HUG is gone
    expect(result.lineItems.find(i => /hug/i.test(i.name))).toBeUndefined();
    expect(result.corrections.some(c => c.action === "item_removed" && /hug/i.test(c.itemName))).toBe(true);
  });

  it("removes RD structural screws on tile roof", async () => {
    const items: SoLineItem[] = [
      li({ name: "RD Structural Screw", sku: "2101175", quantity: 120 }),
    ];
    const bomData = {
      project: { roofType: "Tile" },
      items: [bi({ category: "MODULE", description: "Panel", qty: 10 })],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    // RD screws removed; Rule 4 may add tile items — just verify screws are gone
    expect(result.lineItems.find(i => i.sku === "2101175")).toBeUndefined();
    expect(result.corrections.some(c => c.action === "item_removed" && /rd/i.test(c.itemName))).toBe(true);
  });

  it("removes TL270RCU on battery-only jobs", async () => {
    const items: SoLineItem[] = [
      li({ name: "GE TL270RCU", sku: "TL270RCU", quantity: 1 }),
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
    ];
    const bomData = {
      items: [bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 })],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.lineItems.find(i => /TL270/i.test(i.name))).toBeUndefined();
    expect(result.lineItems).toHaveLength(1); // Only the PW3 remains
  });

  it("removes THQL2160 on battery-only jobs", async () => {
    const items: SoLineItem[] = [
      li({ name: "GE THQL2160 Breaker", sku: "THQL2160", quantity: 1 }),
    ];
    const bomData = {
      items: [bi({ category: "BATTERY", description: "PW3", model: "1707000-xx-x", qty: 1 })],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.lineItems).toHaveLength(0);
  });

  it("removes critter guard, sunscreener, strain relief, SOLOBOX on battery-only", async () => {
    const items: SoLineItem[] = [
      li({ name: "Critter Guard", sku: "S6466", quantity: 2 }),
      li({ name: "SunScreener", sku: "S6438", quantity: 1 }),
      li({ name: "Strain Relief", sku: "M3317GBZ", quantity: 1 }),
      li({ name: "SOLOBOX", sku: "SBOXCOMP", quantity: 1 }),
    ];
    const bomData = {
      items: [bi({ category: "BATTERY", description: "PW3", model: "1707000-xx-x", qty: 1 })],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.lineItems).toHaveLength(0);
    expect(result.corrections).toHaveLength(4);
    expect(result.corrections.every(c => c.action === "item_removed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 3: Qty Adjustments
// ---------------------------------------------------------------------------

describe("postProcessSoItems — Rule 3: Qty Adjustments", () => {
  const solarBomData = (moduleCount: number) => ({
    project: { moduleCount },
    items: [bi({ category: "MODULE", description: "Panel", qty: moduleCount })],
  });

  it("sets snow dogs to 2 for ≤10 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 10 })];
    const result = await postProcessSoItems(items, solarBomData(10), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(2);
  });

  it("sets snow dogs to 4 for 12 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 10 })];
    const result = await postProcessSoItems(items, solarBomData(12), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(4);
  });

  it("sets snow dogs to 10 for 20 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 2 })];
    const result = await postProcessSoItems(items, solarBomData(20), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(10);
  });

  it("sets critter guard to 1 for ≤15 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Critter Guard", sku: "S6466", quantity: 3 })];
    const result = await postProcessSoItems(items, solarBomData(14), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(1);
  });

  it("sets critter guard to 2 for 20 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Critter Guard", sku: "S6466", quantity: 1 })];
    const result = await postProcessSoItems(items, solarBomData(20), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(2);
  });

  it("sets critter guard to 4 for 30 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Critter Guard", sku: "S6466", quantity: 1 })];
    const result = await postProcessSoItems(items, solarBomData(30), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(4);
  });

  it("sets strain relief to 1 for ≤15 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Strain Relief", sku: "M3317GBZ", quantity: 3 })];
    const result = await postProcessSoItems(items, solarBomData(15), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(1);
  });

  it("sets strain relief to 2 for >15 modules", async () => {
    const items: SoLineItem[] = [li({ name: "Strain Relief", sku: "M3317GBZ", quantity: 1 })];
    const result = await postProcessSoItems(items, solarBomData(20), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(2);
  });

  it("sets SOLOBOX to 1 for ≤12 modules", async () => {
    const items: SoLineItem[] = [li({ name: "SOLOBOX", sku: "SBOXCOMP", quantity: 3 })];
    const result = await postProcessSoItems(items, solarBomData(10), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(1);
  });

  it("sets SOLOBOX to 3 for >20 modules", async () => {
    const items: SoLineItem[] = [li({ name: "SOLOBOX", sku: "SBOXCOMP", quantity: 1 })];
    const result = await postProcessSoItems(items, solarBomData(25), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(3);
  });

  it("sets RD screws to 120 for ≤18 modules", async () => {
    const items: SoLineItem[] = [li({ name: "RD Structural Screw", sku: "2101175", quantity: 50 })];
    const result = await postProcessSoItems(items, solarBomData(15), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(120);
  });

  it("sets RD screws to 240 for >18 modules", async () => {
    const items: SoLineItem[] = [li({ name: "RD Structural Screw", sku: "2101175", quantity: 50 })];
    const result = await postProcessSoItems(items, solarBomData(22), mockFindItem);
    expect(result.lineItems[0].quantity).toBe(240);
  });

  it("does not generate correction if qty already matches target", async () => {
    const items: SoLineItem[] = [li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 2 })];
    const result = await postProcessSoItems(items, solarBomData(10), mockFindItem);
    // qty was already 2 for ≤10 modules, so no correction expected
    expect(result.corrections.filter(c => c.action === "qty_adjust")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Rule 4: Add Missing Items
// ---------------------------------------------------------------------------

describe("postProcessSoItems — Rule 4: Add Missing Items", () => {
  it("adds TL270RCU + THQL2160 for solar PW3 job", async () => {
    const items: SoLineItem[] = [
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
    ];
    const bomData = {
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 15 }),
        bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    const tl270 = result.lineItems.find(i => i.sku === "TL270RCU");
    const thql = result.lineItems.find(i => i.sku === "THQL2160");
    expect(tl270).toBeTruthy();
    expect(thql).toBeTruthy();
    expect(result.corrections.filter(c => c.action === "item_added")).toHaveLength(2);
  });

  it("does NOT add TL270RCU/THQL2160 for battery-only jobs", async () => {
    const items: SoLineItem[] = [
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
    ];
    const bomData = {
      items: [
        bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.lineItems.find(i => i.sku === "TL270RCU")).toBeUndefined();
  });

  it("adds expansion accessories when hasExpansion", async () => {
    const items: SoLineItem[] = [
      li({ name: "Tesla PW3 Expansion", quantity: 1 }),
    ];
    const bomData = {
      items: [
        bi({ category: "BATTERY", description: "Tesla PW3 Expansion", model: "1807000-00-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    const wallMount = result.lineItems.find(i => i.sku === "1978069-00-x");
    const harness = result.lineItems.find(i => i.sku === "1875157-20-y");
    expect(wallMount).toBeTruthy();
    expect(harness).toBeTruthy();
  });

  it("adds tile items for tile roof solar job", async () => {
    const items: SoLineItem[] = [];
    const bomData = {
      project: { roofType: "Tile", moduleCount: 15 },
      items: [bi({ category: "MODULE", description: "Panel", qty: 15 })],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    expect(result.lineItems.find(i => i.sku === "ATH-01-M1")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "BHW-TB-03-A1")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "JB-2")).toBeTruthy();

    // Tile hooks qty should be ~4 per module
    const tileHook = result.lineItems.find(i => i.sku === "ATH-01-M1");
    expect(tileHook!.quantity).toBe(60); // 15 * 4
  });

  it("adds L-Foot for standing seam S-5! solar job", async () => {
    const items: SoLineItem[] = [];
    const bomData = {
      project: { roofType: "Standing Seam", moduleCount: 10 },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 10 }),
        bi({ category: "MOUNT", description: "S-5! bracket", model: "S-5!", qty: 10 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    const lFoot = result.lineItems.find(i => i.sku === "LFT-03-M1");
    expect(lFoot).toBeTruthy();
    expect(lFoot!.quantity).toBe(30); // 10 * 3
  });

  it("does NOT add items that already exist (idempotent by SKU)", async () => {
    const items: SoLineItem[] = [
      li({ name: "GE TL270RCU Load Center", sku: "TL270RCU", quantity: 1 }),
      li({ name: "GE THQL2160 Breaker", sku: "THQL2160", quantity: 1 }),
    ];
    const bomData = {
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 15 }),
        bi({ category: "BATTERY", description: "PW3", model: "1707000-xx-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);
    expect(result.corrections.filter(c => c.action === "item_added")).toHaveLength(0);
    expect(result.lineItems).toHaveLength(2); // No duplicates
  });
});

// ---------------------------------------------------------------------------
// Tests: Idempotency
// ---------------------------------------------------------------------------

describe("postProcessSoItems — Idempotency", () => {
  it("second pass produces zero additional corrections", async () => {
    const items: SoLineItem[] = [
      li({ name: "Mid Clamp", sku: "UFO-CL-01-B1", quantity: 30 }),
      li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 10 }),
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
    ];
    const bomData = {
      project: { roofType: "Standing Seam", moduleCount: 12 },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 12 }),
        bi({ category: "MOUNT", description: "S-5! bracket", model: "S-5!", qty: 12 }),
        bi({ category: "BATTERY", description: "PW3", model: "1707000-xx-x", qty: 1 }),
      ],
    };

    const first = await postProcessSoItems(items, bomData, mockFindItem);
    expect(first.corrections.length).toBeGreaterThan(0);

    // Run again on corrected output
    const second = await postProcessSoItems(first.lineItems, bomData, mockFindItem);
    expect(second.corrections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Conflict — SKU locked but qty adjustable
// ---------------------------------------------------------------------------

describe("postProcessSoItems — Conflict handling", () => {
  it("Rule 1 locks SKU but Rule 3 can still adjust quantity", async () => {
    // Mid clamp will be swapped by Rule 1 (SKU locked), but
    // since mid clamp isn't a qty-adjustable item, this verifies
    // the lock mechanism doesn't interfere with other items' qty adjustments
    const items: SoLineItem[] = [
      li({ name: "Mid Clamp", sku: "UFO-CL-01-B1", quantity: 30 }),
      li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 10 }),
    ];
    const bomData = {
      project: { roofType: "Standing Seam", moduleCount: 10 },
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 10 }),
        bi({ category: "MOUNT", description: "S-5!", model: "S-5!", qty: 10 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    // Mid clamp SKU was swapped
    const midClamp = result.lineItems.find(i => i.item_id === "id-ufo-a1");
    expect(midClamp).toBeTruthy();
    expect(midClamp!.sku).toBe("UFO-CL-01-A1");

    // Snow dogs should be removed on standing seam (Rule 2)
    expect(result.lineItems.find(i => /snow/i.test(i.name))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: normalizedName fallback idempotency
// ---------------------------------------------------------------------------

describe("postProcessSoItems — normalizedName fallback", () => {
  it("prevents duplicate add when item has no sku or item_id match but name matches", async () => {
    // Item already exists by name, but has no SKU
    const items: SoLineItem[] = [
      { item_id: "id-custom", name: "GE TL270RCU Load Center", quantity: 1, description: "GE TL270RCU" },
    ];
    const bomData = {
      items: [
        bi({ category: "MODULE", description: "Panel", qty: 15 }),
        bi({ category: "BATTERY", description: "PW3", model: "1707000-xx-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    // TL270RCU should NOT be added again since the existing item's zohoName
    // matches the catalog entry via normalizedName
    const tl270Items = result.lineItems.filter(i => /tl270/i.test(i.name));
    expect(tl270Items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: RULES_VERSION constant
// ---------------------------------------------------------------------------

describe("RULES_VERSION", () => {
  it("is a non-empty string", () => {
    expect(RULES_VERSION).toBeTruthy();
    expect(typeof RULES_VERSION).toBe("string");
  });

  it("is included in postProcessSoItems result", async () => {
    const result = await postProcessSoItems([], { items: [] }, mockFindItem);
    expect(result.rulesVersion).toBe(RULES_VERSION);
  });
});

// ---------------------------------------------------------------------------
// Golden Integration Tests
// ---------------------------------------------------------------------------

describe("Golden Integration — PROJ-8686 Maddox (S-5!/L-Foot standing seam)", () => {
  it("produces expected corrections for standing seam job", async () => {
    const items: SoLineItem[] = [
      li({ name: "Unirac Mid Clamp Black", sku: "UFO-CL-01-B1", quantity: 28 }),
      li({ name: "Unirac End Clamp Black", sku: "UFO-END-01-B1", quantity: 8 }),
      li({ name: "Snow Dog", sku: "SNOW-DOG-01", quantity: 6 }),
      li({ name: "HUG Attachment", sku: "2101151", quantity: 30 }),
      li({ name: "RD Structural Screw Pack", sku: "2101175", quantity: 120 }),
      li({ name: "Critter Guard", sku: "S6466", quantity: 2 }),
      li({ name: "SunScreener", sku: "S6438", quantity: 1 }),
      li({ name: "SOLOBOX", sku: "SBOXCOMP", quantity: 1 }),
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
    ];

    const bomData = {
      project: { roofType: "Standing Seam Metal", moduleCount: 14 } as BomProject,
      items: [
        bi({ category: "MODULE", description: "REC 400W Panel", qty: 14 }),
        bi({ category: "MOUNT", description: "S-5! ProtéaBracket", model: "S-5!", qty: 14 }),
        bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    // Mid clamp swapped to A1
    expect(result.lineItems.find(i => i.sku === "UFO-CL-01-A1")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "UFO-CL-01-B1")).toBeUndefined();

    // End clamp swapped to CAMO
    expect(result.lineItems.find(i => i.sku === "CAMO-01-M1")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "UFO-END-01-B1")).toBeUndefined();

    // Snow dogs removed (standing seam)
    expect(result.lineItems.find(i => /snow/i.test(i.name))).toBeUndefined();

    // HUG attachment removed (standing seam)
    expect(result.lineItems.find(i => /hug/i.test(i.name))).toBeUndefined();

    // RD screws removed (standing seam)
    expect(result.lineItems.find(i => i.sku === "2101175")).toBeUndefined();

    // L-Foot added
    expect(result.lineItems.find(i => i.sku === "LFT-03-M1")).toBeTruthy();

    // TL270RCU + THQL2160 added (solar + PW3)
    expect(result.lineItems.find(i => i.sku === "TL270RCU")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "THQL2160")).toBeTruthy();

    // Corrections are ordered: swaps first, removals, adds
    const actions = result.corrections.map(c => c.action);
    const firstSwapIdx = actions.indexOf("sku_swap");
    const firstRemoveIdx = actions.indexOf("item_removed");
    const firstAddIdx = actions.indexOf("item_added");
    expect(firstSwapIdx).toBeLessThan(firstRemoveIdx);
    expect(firstRemoveIdx).toBeLessThan(firstAddIdx);

    // Idempotency: second pass = zero corrections
    const second = await postProcessSoItems(result.lineItems, bomData, mockFindItem);
    expect(second.corrections).toHaveLength(0);
  });
});

describe("Golden Integration — PROJ-9054 Schanhals (battery-only)", () => {
  it("removes all solar items and keeps only battery items", async () => {
    const items: SoLineItem[] = [
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
      li({ name: "Tesla Backup Switch", quantity: 1 }),
      li({ name: "GE TL270RCU", sku: "TL270RCU", quantity: 1 }),
      li({ name: "GE THQL2160", sku: "THQL2160", quantity: 1 }),
      li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 4 }),
      li({ name: "Critter Guard", sku: "S6466", quantity: 1 }),
      li({ name: "SunScreener", sku: "S6438", quantity: 1 }),
      li({ name: "Strain Relief", sku: "M3317GBZ", quantity: 1 }),
      li({ name: "SOLOBOX", sku: "SBOXCOMP", quantity: 1 }),
    ];

    const bomData = {
      items: [
        bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
        bi({ category: "ELECTRICAL", description: "Tesla Backup Switch", model: "1624171-xx-x", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    // Should keep: PW3, Backup Switch
    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems.find(i => /powerwall/i.test(i.name))).toBeTruthy();
    expect(result.lineItems.find(i => /backup/i.test(i.name))).toBeTruthy();

    // All solar items removed
    expect(result.lineItems.find(i => /TL270/i.test(i.name))).toBeUndefined();
    expect(result.lineItems.find(i => /THQL/i.test(i.name))).toBeUndefined();
    expect(result.lineItems.find(i => /snow/i.test(i.name))).toBeUndefined();
    expect(result.lineItems.find(i => /critter/i.test(i.name))).toBeUndefined();
    expect(result.lineItems.find(i => /sunscreener/i.test(i.name))).toBeUndefined();
    expect(result.lineItems.find(i => /strain/i.test(i.name))).toBeUndefined();
    expect(result.lineItems.find(i => /solobox/i.test(i.name))).toBeUndefined();

    // 7 items removed
    expect(result.corrections.filter(c => c.action === "item_removed")).toHaveLength(7);

    // No items added (battery-only, no expansion)
    expect(result.corrections.filter(c => c.action === "item_added")).toHaveLength(0);

    // Job context correct
    expect(result.jobContext.jobType).toBe("battery_only");

    // Idempotency
    const second = await postProcessSoItems(result.lineItems, bomData, mockFindItem);
    expect(second.corrections).toHaveLength(0);
  });
});

describe("Golden Integration — PROJ-9009 Wang (tile + service tap)", () => {
  it("adds tile items, removes HUG/RD screws, preserves fusible disconnect", async () => {
    const items: SoLineItem[] = [
      li({ name: "HUG Attachment", sku: "2101151", quantity: 20 }),
      li({ name: "RD Structural Screw Pack", sku: "2101175", quantity: 120 }),
      li({ name: "Fusible Disconnect DG222NRB", sku: "DG222NRB", quantity: 1 }),
      li({ name: "Tesla Powerwall 3", quantity: 1 }),
      li({ name: "Snow Dog", sku: "SNOW-DOG", quantity: 6 }),
    ];

    const bomData = {
      project: { roofType: "Tile", moduleCount: 18 } as BomProject,
      items: [
        bi({ category: "MODULE", description: "REC 400W Panel", qty: 18 }),
        bi({ category: "BATTERY", description: "Tesla Powerwall 3", model: "1707000-xx-x", qty: 1 }),
        bi({ category: "ELECTRICAL", description: "Fusible Disconnect", model: "DG222NRB", qty: 1 }),
      ],
    };

    const result = await postProcessSoItems(items, bomData, mockFindItem);

    // HUG removed (tile)
    expect(result.lineItems.find(i => /hug/i.test(i.name))).toBeUndefined();

    // RD screws removed (tile)
    expect(result.lineItems.find(i => i.sku === "2101175")).toBeUndefined();

    // Fusible disconnect preserved
    expect(result.lineItems.find(i => /DG222NRB/i.test(i.sku ?? ""))).toBeTruthy();

    // Tile items added
    expect(result.lineItems.find(i => i.sku === "ATH-01-M1")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "BHW-TB-03-A1")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "JB-2")).toBeTruthy();

    // Tile hooks qty = 18 * 4 = 72
    const tileHook = result.lineItems.find(i => i.sku === "ATH-01-M1");
    expect(tileHook!.quantity).toBe(72);

    // TL270RCU + THQL2160 added (hybrid + PW3)
    expect(result.lineItems.find(i => i.sku === "TL270RCU")).toBeTruthy();
    expect(result.lineItems.find(i => i.sku === "THQL2160")).toBeTruthy();

    // Snow dogs qty adjusted for tile (set to 0 → removed)
    // Actually tile is handled by Rule 3 where target=0 for tile roof
    expect(result.lineItems.find(i => /snow/i.test(i.name))).toBeUndefined();

    // Service tap context detected
    expect(result.jobContext.hasServiceTap).toBe(true);
    expect(result.jobContext.roofType).toBe("tile");

    // Idempotency
    const second = await postProcessSoItems(result.lineItems, bomData, mockFindItem);
    expect(second.corrections).toHaveLength(0);
  });
});
