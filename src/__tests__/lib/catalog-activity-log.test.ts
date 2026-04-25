import { logCatalogSync, logCatalogProductCreated } from "@/lib/catalog-activity-log";
import * as db from "@/lib/db";

jest.mock("@/lib/db", () => ({
  logActivity: jest.fn().mockResolvedValue({ id: "act_1" }),
}));

describe("logCatalogSync", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes one ActivityLog row per sync with structured outcomes metadata", async () => {
    await logCatalogSync({
      internalProductId: "prod_1",
      productName: "Silfab 400W",
      userEmail: "zach@photonbrothers.com",
      source: "wizard",
      outcomes: {
        INTERNAL: { status: "success", externalId: "prod_1" },
        HUBSPOT: { status: "success", externalId: "12345" },
        ZOHO: { status: "failed", message: "API 503" },
        ZUPER: { status: "skipped", message: "Not selected" },
      },
      durationMs: 4521,
    });

    expect(db.logActivity).toHaveBeenCalledTimes(1);
    const call = (db.logActivity as jest.Mock).mock.calls[0][0];
    expect(call.type).toBe("CATALOG_SYNC_FAILED");
    expect(call.entityType).toBe("internal_product");
    expect(call.entityId).toBe("prod_1");
    expect(call.entityName).toBe("Silfab 400W");
    expect(call.userEmail).toBe("zach@photonbrothers.com");
    expect(call.metadata).toMatchObject({
      source: "wizard",
      outcomes: expect.any(Object),
      systemsAttempted: ["INTERNAL", "HUBSPOT", "ZOHO", "ZUPER"],
      successCount: 2,
      failedCount: 1,
      skippedCount: 1,
    });
    expect(call.durationMs).toBe(4521);
  });

  test("uses CATALOG_SYNC_FAILED type and HIGH risk when any system failed", async () => {
    await logCatalogSync({
      internalProductId: "prod_2",
      productName: "Test",
      userEmail: "x@y.com",
      source: "modal",
      outcomes: {
        HUBSPOT: { status: "failed", message: "boom" },
      },
    });
    const call = (db.logActivity as jest.Mock).mock.calls[0][0];
    expect(call.type).toBe("CATALOG_SYNC_FAILED");
    expect(call.riskLevel).toBe("HIGH");
  });
});

describe("logCatalogProductCreated", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes CATALOG_PRODUCT_CREATED row with category in metadata", async () => {
    await logCatalogProductCreated({
      internalProductId: "prod_3",
      category: "MODULE",
      brand: "Silfab",
      model: "SIL-400-NU",
      userEmail: "z@p.com",
      source: "wizard",
    });
    const call = (db.logActivity as jest.Mock).mock.calls[0][0];
    expect(call.type).toBe("CATALOG_PRODUCT_CREATED");
    expect(call.entityName).toBe("Silfab SIL-400-NU");
    expect(call.metadata).toMatchObject({ category: "MODULE", source: "wizard" });
  });
});
