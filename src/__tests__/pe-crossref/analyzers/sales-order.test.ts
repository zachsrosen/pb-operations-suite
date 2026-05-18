import { SalesOrderAnalyzer } from "@/lib/pe-crossref/analyzers/sales-order";
import type { CrossRefContext, NormalizedSalesOrder, ExtractedPlanset } from "@/lib/pe-crossref/types";

const baseContext = (overrides: Partial<CrossRefContext> = {}): CrossRefContext => ({
  deal: {
    dealId: "d1",
    dealName: "PROJ-9542 | Brownell, Matt | 16578 W 55th Dr",
    address: "",
    systemType: "solar+battery",
    stageName: "PTO",
    peM1Status: null,
    peM2Status: null,
    rootFolderId: "root",
    designFolderId: null,
  },
  planset: null,
  salesOrder: null,
  powerHubAsset: null,
  installPhotos: [],
  nameplateExtractions: new Map(),
  monitoringFolder: null,
  latestAuditRun: null,
  ...overrides,
});

const so = (overrides: Partial<NormalizedSalesOrder> = {}): NormalizedSalesOrder => ({
  soNumber: "SO-9542",
  customerName: "Matt Brownell",
  lineItems: [
    { index: 0, sku: "1707000-21-Y", description: "Tesla Powerwall 3 (1707000-21-Y)", qty: 2 },
    { index: 1, sku: "1624171-00-E", description: "Tesla Backup Switch 200A (1624171-00-E)", qty: 1 },
  ],
  ...overrides,
});

const planset = (overrides: Partial<ExtractedPlanset> = {}): ExtractedPlanset => ({
  fileId: "planset-1",
  fileName: "planset.pdf",
  specsByPage: [],
  ...overrides,
});

describe("SalesOrderAnalyzer", () => {
  it("emits nothing when no SO is available", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(baseContext());
    expect(tasks).toHaveLength(0);
  });

  it("emits nothing on a clean SO matching the deal customer", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(baseContext({ salesOrder: so() }));
    expect(tasks).toHaveLength(0);
  });

  // ── P2 ───────────────────────────────────────────────────────────────
  it("emits P2 WRONG CUSTOMER when SO customer doesn't match deal customer", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({ salesOrder: so({ customerName: "Christopher Schnoor" }) }),
    );
    const p2 = tasks.find((t) => t.pCode === "P2");
    expect(p2).toBeDefined();
    expect(p2?.severity).toBe("critical");
    expect(p2?.message).toContain("Christopher Schnoor");
    expect(p2?.message).toContain("Brownell, Matt");
  });

  it("tolerates name format differences (Last, First vs First Last)", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({ salesOrder: so({ customerName: "Brownell, Matt" }) }),
    );
    expect(tasks.find((t) => t.pCode === "P2")).toBeUndefined();
  });

  // ── P7 / P8 / P9 ─────────────────────────────────────────────────────
  it("emits P7 PW3 LEGACY TEXT for descriptions containing 'Powerwall 3 (USA module)'", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [
            { index: 0, sku: null, description: "Powerwall 3 (USA module) — note: 11-J", qty: 2 },
          ],
        }),
      }),
    );
    const p7 = tasks.find((t) => t.pCode === "P7");
    expect(p7).toBeDefined();
    expect(p7?.identityKey).toBe("P7@v1:so:SO-9542:line:0:pw3-text");
    expect(p7?.severity).toBe("conditional");
  });

  it("emits P7 also when description contains '-11-J' suffix", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Tesla 1707000-11-J variant", qty: 2 }],
        }),
      }),
    );
    expect(tasks.find((t) => t.pCode === "P7")).toBeDefined();
  });

  it("emits P8 PW3 GENERIC SKU for descriptions containing '1707000-XX-Y'", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: "1707000-21-Y", description: "Tesla 1707000-XX-Y", qty: 2 }],
        }),
      }),
    );
    const p8 = tasks.find((t) => t.pCode === "P8");
    expect(p8).toBeDefined();
    expect(p8?.action).toContain("Tesla 1707000-21-Y");
  });

  it("emits P9 BS GENERIC when BS line description is not 1624171-00-E", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Tesla Backup Switch (1624171-XX-Y)", qty: 1 }],
        }),
      }),
    );
    const p9 = tasks.find((t) => t.pCode === "P9");
    expect(p9).toBeDefined();
    expect(p9?.action).toContain("1624171-00-E");
  });

  it("does NOT emit P9 when BS description contains 1624171-00-E", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Tesla Backup Switch (1624171-00-E)", qty: 1 }],
        }),
      }),
    );
    expect(tasks.find((t) => t.pCode === "P9")).toBeUndefined();
  });

  // ── P3 / P4 / P5 (require planset) ───────────────────────────────────
  it("skips P3/P4/P5 when no planset is extracted", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({ salesOrder: so({ lineItems: [] }) }),
    );
    expect(tasks.find((t) => t.pCode === "P3")).toBeUndefined();
    expect(tasks.find((t) => t.pCode === "P4")).toBeUndefined();
    expect(tasks.find((t) => t.pCode === "P5")).toBeUndefined();
  });

  it("emits P3 ADD PW3 when planset has PW3 but SO has no PW3 line", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Tesla Backup Switch (1624171-00-E)", qty: 1 }],
        }),
        planset: planset({
          specsByPage: [
            { page: 5, pw3Model: "1707000-21-Y", bsModel: null, expansionUnitModel: null, moduleBrand: null, moduleQty: null, inverterModel: null },
          ],
        }),
      }),
    );
    const p3 = tasks.find((t) => t.pCode === "P3");
    expect(p3).toBeDefined();
    expect(p3?.severity).toBe("major");
  });

  it("emits P4 ADD INVERTER when planset has inverter but SO has no inverter line", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Tesla Powerwall 3", qty: 2 }],
        }),
        planset: planset({
          specsByPage: [
            { page: 5, pw3Model: null, bsModel: null, expansionUnitModel: null, moduleBrand: null, moduleQty: null, inverterModel: "Tesla Solar Inverter 7.6kW" },
          ],
        }),
      }),
    );
    const p4 = tasks.find((t) => t.pCode === "P4");
    expect(p4).toBeDefined();
    expect(p4?.message).toContain("Tesla Solar Inverter 7.6kW");
  });

  it("emits P5 MODULE BRAND MISMATCH when planset and SO disagree on brand", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Hyundai HiN-T440NF(BK) 440W module", qty: 60 }],
        }),
        planset: planset({
          specsByPage: [
            { page: 5, pw3Model: null, bsModel: null, expansionUnitModel: null, moduleBrand: "SEG Solar", moduleQty: 60, inverterModel: null },
          ],
        }),
      }),
    );
    const p5 = tasks.find((t) => t.pCode === "P5" && t.title === "MODULE BRAND MISMATCH");
    expect(p5).toBeDefined();
    expect(p5?.message).toContain("SEG Solar");
  });

  it("emits P5 MODULE QTY MISMATCH when planset and SO disagree on count", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [{ index: 0, sku: null, description: "Hyundai module", qty: 38 }],
        }),
        planset: planset({
          specsByPage: [
            { page: 5, pw3Model: null, bsModel: null, expansionUnitModel: null, moduleBrand: "Hyundai", moduleQty: 36, inverterModel: null },
          ],
        }),
      }),
    );
    const p5 = tasks.find((t) => t.pCode === "P5" && t.title === "MODULE QUANTITY MISMATCH");
    expect(p5).toBeDefined();
    expect(p5?.message).toContain("36");
    expect(p5?.message).toContain("38");
  });

  it("a single SO can fire P7+P8+P9 simultaneously across different lines", async () => {
    const tasks = await SalesOrderAnalyzer.detectTasks(
      baseContext({
        salesOrder: so({
          lineItems: [
            { index: 0, sku: null, description: "Powerwall 3 (USA module)", qty: 2 },           // P7
            { index: 1, sku: null, description: "Tesla 1707000-XX-Y", qty: 1 },                 // P8
            { index: 2, sku: null, description: "Tesla Backup Switch (1624171-XX-Y)", qty: 1 }, // P9
          ],
        }),
      }),
    );
    const codes = tasks.map((t) => t.pCode).sort();
    expect(codes).toEqual(["P7", "P8", "P9"]);
  });
});
