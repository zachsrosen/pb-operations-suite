import {
  buildCleanupUpdatePlan,
  collectCacheCleanupTargets,
  isExternalResultCacheSafe,
  runInternalCleanupEngine,
  type CleanupSkuRecord,
  type ProductCleanupActions,
} from "@/lib/product-cleanup-engine";
import type { CleanupAdapterResult } from "@/lib/product-cleanup-adapters";

const baseSku: CleanupSkuRecord = {
  id: "sku_1",
  isActive: true,
  hubspotProductId: "hs_123",
  zuperItemId: "zu_456",
  zohoItemId: "zo_789",
};

const baseActions: ProductCleanupActions = {
  internal: "deactivate",
  links: "unlink_selected",
  external: "delete_selected",
  sources: ["hubspot"],
  deleteCachedProducts: true,
};

function adapterResult(
  source: CleanupAdapterResult["source"],
  status: CleanupAdapterResult["status"]
): CleanupAdapterResult {
  return {
    source,
    externalId: `${source}_id`,
    status,
    message: `${source}:${status}`,
  };
}

describe("product-cleanup-engine", () => {
  it("buildCleanupUpdatePlan clears selected link fields and deactivates when active", () => {
    const plan = buildCleanupUpdatePlan(baseSku, baseActions);

    expect(plan.changedLinkFields.sort()).toEqual(["hubspotProductId"]);
    expect(plan.willDeactivate).toBe(true);
    expect(plan.updateData).toEqual({
      hubspotProductId: null,
      isActive: false,
    });
  });

  it("isExternalResultCacheSafe only allows deleted/archived/not_found", () => {
    expect(isExternalResultCacheSafe(adapterResult("hubspot", "deleted"))).toBe(true);
    expect(isExternalResultCacheSafe(adapterResult("hubspot", "archived"))).toBe(true);
    expect(isExternalResultCacheSafe(adapterResult("hubspot", "not_found"))).toBe(true);
    expect(isExternalResultCacheSafe(adapterResult("hubspot", "failed"))).toBe(false);
    expect(isExternalResultCacheSafe(adapterResult("hubspot", "skipped"))).toBe(false);
    expect(isExternalResultCacheSafe(undefined)).toBe(false);
  });

  it("collectCacheCleanupTargets only includes sources with successful/idempotent external outcomes", () => {
    const targets = collectCacheCleanupTargets(baseSku, baseActions, {
      hubspot: adapterResult("hubspot", "archived"),
    });

    expect(targets).toEqual([
      {
        source: "hubspot",
        catalogSource: "HUBSPOT",
        externalId: "hs_123",
      },
    ]);
  });

  it("runInternalCleanupEngine dry-run returns planned results and does not write", async () => {
    const mockUpdate = jest.fn();
    const mockDeleteMany = jest.fn();
    const prismaClient = {
      equipmentSku: {
        update: mockUpdate,
      },
      catalogProduct: {
        deleteMany: mockDeleteMany,
      },
    } as unknown as Parameters<typeof runInternalCleanupEngine>[0]["prismaClient"];

    const result = await runInternalCleanupEngine({
      prismaClient,
      sku: baseSku,
      actions: baseActions,
      dryRun: true,
      externalBySource: {
        hubspot: adapterResult("hubspot", "deleted"),
      },
    });

    expect(result.links.status).toBe("planned");
    expect(result.internal.status).toBe("planned");
    expect(result.cache.status).toBe("planned");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});

