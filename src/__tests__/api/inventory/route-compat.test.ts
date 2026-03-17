/**
 * Compatibility wrapper tests
 *
 * Verify that deprecated /api/inventory/skus/** wrappers re-export
 * the identical handler functions from /api/inventory/products/**.
 * These are import identity checks — no HTTP calls, no mocking.
 *
 * Route segment configs (runtime, maxDuration) are declared inline
 * in wrappers due to Turbopack static analysis requirements, so we
 * verify value equality rather than reference identity.
 */

// Mock heavy dependencies so module imports resolve without side effects
jest.mock("@/lib/db", () => ({
  prisma: {},
  logActivity: jest.fn(),
  getUserByEmail: jest.fn(),
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
  withScope: jest.fn(),
  startSpan: jest.fn(),
}));

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn(),
}));

jest.mock("@/lib/hubspot", () => ({
  createOrUpdateHubSpotProduct: jest.fn(),
  fetchAllProjects: jest.fn(),
  filterProjectsForContext: jest.fn(),
}));

jest.mock("@/lib/cache", () => ({
  appCache: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  CACHE_KEYS: {},
}));

jest.mock("@/lib/sentry-request", () => ({
  tagSentryRequest: jest.fn(),
}));

jest.mock("@/lib/catalog-sync-confirmation", () => ({
  isCatalogSyncEnabled: jest.fn(),
  validateSyncConfirmationToken: jest.fn(),
}));

jest.mock("@/lib/bulk-sync-confirmation", () => ({
  validateBulkSyncToken: jest.fn(),
  validateContinuationToken: jest.fn(),
  hashToken: jest.fn(),
  computeBulkSkuSyncHash: jest.fn(),
  buildContinuationToken: jest.fn(),
  withHubSpotRetry: jest.fn(),
  buildBulkSyncConfirmation: jest.fn(),
}));

jest.mock("@/lib/catalog-sync", () => ({
  previewSyncToLinkedSystems: jest.fn(),
  computePreviewHash: jest.fn(),
  executeSyncToLinkedSystems: jest.fn(),
}));

jest.mock("@/lib/canonical", () => ({
  canonicalToken: jest.fn(),
  buildCanonicalKey: jest.fn(),
}));

jest.mock("@/lib/catalog-fields", () => ({
  CATEGORY_CONFIGS: {},
  filterMetadataToSpecFields: jest.fn(),
  getCategoryFields: jest.fn(),
  getSpecTableName: jest.fn(),
}));

jest.mock("@/lib/role-permissions", () => ({
  normalizeRole: jest.fn((r: string) => r),
}));

jest.mock("@/generated/prisma/enums", () => ({
  EquipmentCategory: {},
}));

import * as canonicalMain from "@/app/api/inventory/products/route";
import * as compatMain from "@/app/api/inventory/skus/route";

import * as canonicalStats from "@/app/api/inventory/products/stats/route";
import * as compatStats from "@/app/api/inventory/skus/stats/route";

import * as canonicalMerge from "@/app/api/inventory/products/merge/route";
import * as compatMerge from "@/app/api/inventory/skus/merge/route";

import * as canonicalSyncEnabled from "@/app/api/inventory/products/sync-enabled/route";
import * as compatSyncEnabled from "@/app/api/inventory/skus/sync-enabled/route";

import * as canonicalSyncBulk from "@/app/api/inventory/products/sync-bulk/route";
import * as compatSyncBulk from "@/app/api/inventory/skus/sync-bulk/route";

import * as canonicalSyncBulkConfirm from "@/app/api/inventory/products/sync-bulk/confirm/route";
import * as compatSyncBulkConfirm from "@/app/api/inventory/skus/sync-bulk/confirm/route";

import * as canonicalSyncHubspotBulk from "@/app/api/inventory/products/sync-hubspot-bulk/route";
import * as compatSyncHubspotBulk from "@/app/api/inventory/skus/sync-hubspot-bulk/route";

import * as canonicalSyncHubspotBulkConfirm from "@/app/api/inventory/products/sync-hubspot-bulk/confirm/route";
import * as compatSyncHubspotBulkConfirm from "@/app/api/inventory/skus/sync-hubspot-bulk/confirm/route";

import * as canonicalIdSync from "@/app/api/inventory/products/[id]/sync/route";
import * as compatIdSync from "@/app/api/inventory/skus/[id]/sync/route";

import * as canonicalIdSyncConfirm from "@/app/api/inventory/products/[id]/sync/confirm/route";
import * as compatIdSyncConfirm from "@/app/api/inventory/skus/[id]/sync/confirm/route";

import * as canonicalSyncProducts from "@/app/api/inventory/sync-products/route";
import * as compatSyncSkus from "@/app/api/inventory/sync-skus/route";

describe("/api/inventory/skus → /api/inventory/products compat wrappers", () => {
  test("main route: GET, POST, PATCH, DELETE", () => {
    expect(compatMain.GET).toBe(canonicalMain.GET);
    expect(compatMain.POST).toBe(canonicalMain.POST);
    expect(compatMain.PATCH).toBe(canonicalMain.PATCH);
    expect(compatMain.DELETE).toBe(canonicalMain.DELETE);
  });

  test("stats route: GET", () => {
    expect(compatStats.GET).toBe(canonicalStats.GET);
  });

  test("merge route: POST", () => {
    expect(compatMerge.POST).toBe(canonicalMerge.POST);
  });

  test("sync-enabled route: GET, runtime", () => {
    expect(compatSyncEnabled.GET).toBe(canonicalSyncEnabled.GET);
    expect(compatSyncEnabled.runtime).toBe(canonicalSyncEnabled.runtime);
  });

  test("sync-bulk route: POST, runtime, maxDuration", () => {
    expect(compatSyncBulk.POST).toBe(canonicalSyncBulk.POST);
    expect(compatSyncBulk.runtime).toBe(canonicalSyncBulk.runtime);
    expect(compatSyncBulk.maxDuration).toBe(canonicalSyncBulk.maxDuration);
  });

  test("sync-bulk/confirm route: POST, runtime", () => {
    expect(compatSyncBulkConfirm.POST).toBe(canonicalSyncBulkConfirm.POST);
    expect(compatSyncBulkConfirm.runtime).toBe(canonicalSyncBulkConfirm.runtime);
  });

  test("sync-hubspot-bulk route: POST, runtime, maxDuration", () => {
    expect(compatSyncHubspotBulk.POST).toBe(canonicalSyncHubspotBulk.POST);
    expect(compatSyncHubspotBulk.runtime).toBe(canonicalSyncHubspotBulk.runtime);
    expect(compatSyncHubspotBulk.maxDuration).toBe(canonicalSyncHubspotBulk.maxDuration);
  });

  test("sync-hubspot-bulk/confirm route: POST, runtime", () => {
    expect(compatSyncHubspotBulkConfirm.POST).toBe(canonicalSyncHubspotBulkConfirm.POST);
    expect(compatSyncHubspotBulkConfirm.runtime).toBe(canonicalSyncHubspotBulkConfirm.runtime);
  });

  test("[id]/sync route: GET, POST, runtime, maxDuration", () => {
    expect(compatIdSync.GET).toBe(canonicalIdSync.GET);
    expect(compatIdSync.POST).toBe(canonicalIdSync.POST);
    expect(compatIdSync.runtime).toBe(canonicalIdSync.runtime);
    expect(compatIdSync.maxDuration).toBe(canonicalIdSync.maxDuration);
  });

  test("[id]/sync/confirm route: POST, runtime", () => {
    expect(compatIdSyncConfirm.POST).toBe(canonicalIdSyncConfirm.POST);
    expect(compatIdSyncConfirm.runtime).toBe(canonicalIdSyncConfirm.runtime);
  });

  test("sync-skus → sync-products: POST", () => {
    expect(compatSyncSkus.POST).toBe(canonicalSyncProducts.POST);
  });
});
