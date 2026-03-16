import {
  createSyncConfirmationToken,
  validateSyncConfirmationToken,
  buildSyncConfirmation,
  isCatalogSyncEnabled,
  CATALOG_SYNC_CONFIRM_TTL_MS,
} from "@/lib/catalog-sync-confirmation";

const TEST_SECRET = "test-secret-at-least-32-chars-long-for-hmac";

beforeAll(() => {
  process.env.PRODUCT_CLEANUP_CONFIRM_SECRET = TEST_SECRET;
});

describe("catalog-sync-confirmation", () => {
  it("creates and validates a token round-trip", () => {
    const issuedAt = Date.now();
    const token = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho", "hubspot"], changesHash: "abc123", issuedAt },
      TEST_SECRET,
    );

    const result = validateSyncConfirmationToken({
      token,
      issuedAt,
      internalProductId: "sku_1",
      systems: ["zoho", "hubspot"],
      changesHash: "abc123",
    });
    expect(result).toEqual({ ok: true });
  });

  it("is deterministic for same input (system order independent)", () => {
    const issuedAt = Date.now();
    const token1 = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["hubspot", "zoho"], changesHash: "abc", issuedAt },
      TEST_SECRET,
    );
    const token2 = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho", "hubspot"], changesHash: "abc", issuedAt },
      TEST_SECRET,
    );
    expect(token1).toBe(token2);
  });

  it("rejects expired tokens", () => {
    const issuedAt = Date.now() - CATALOG_SYNC_CONFIRM_TTL_MS - 1000;
    const token = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho"], changesHash: "abc", issuedAt },
      TEST_SECRET,
    );

    const result = validateSyncConfirmationToken({
      token,
      issuedAt,
      internalProductId: "sku_1",
      systems: ["zoho"],
      changesHash: "abc",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
  });

  it("rejects future issuedAt", () => {
    const issuedAt = Date.now() + 120_000; // 2 minutes in the future
    const token = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho"], changesHash: "abc", issuedAt },
      TEST_SECRET,
    );

    const result = validateSyncConfirmationToken({
      token,
      issuedAt,
      internalProductId: "sku_1",
      systems: ["zoho"],
      changesHash: "abc",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it("rejects tampered changesHash", () => {
    const issuedAt = Date.now();
    const token = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho"], changesHash: "original", issuedAt },
      TEST_SECRET,
    );

    const result = validateSyncConfirmationToken({
      token,
      issuedAt,
      internalProductId: "sku_1",
      systems: ["zoho"],
      changesHash: "tampered",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid/i);
  });

  it("rejects system set mismatch between confirm and execute", () => {
    const issuedAt = Date.now();
    const token = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho"], changesHash: "abc", issuedAt },
      TEST_SECRET,
    );

    const result = validateSyncConfirmationToken({
      token,
      issuedAt,
      internalProductId: "sku_1",
      systems: ["zoho", "hubspot"], // Added hubspot after confirm
      changesHash: "abc",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid/i);
  });

  it("rejects different internalProductId", () => {
    const issuedAt = Date.now();
    const token = createSyncConfirmationToken(
      { internalProductId: "sku_1", systems: ["zoho"], changesHash: "abc", issuedAt },
      TEST_SECRET,
    );

    const result = validateSyncConfirmationToken({
      token,
      issuedAt,
      internalProductId: "sku_2",
      systems: ["zoho"],
      changesHash: "abc",
    });
    expect(result.ok).toBe(false);
  });

  it("buildSyncConfirmation returns token, issuedAt, expiresAt", () => {
    const result = buildSyncConfirmation({
      internalProductId: "sku_1",
      systems: ["zoho"],
      changesHash: "abc",
    });
    expect(result.token).toBeTruthy();
    expect(typeof result.issuedAt).toBe("number");
    expect(result.expiresAt).toBe(result.issuedAt + CATALOG_SYNC_CONFIRM_TTL_MS);
  });

  it("isCatalogSyncEnabled respects env var", () => {
    const orig = process.env.CATALOG_SYNC_ENABLED;
    process.env.CATALOG_SYNC_ENABLED = "true";
    expect(isCatalogSyncEnabled()).toBe(true);

    process.env.CATALOG_SYNC_ENABLED = "false";
    expect(isCatalogSyncEnabled()).toBe(false);

    delete process.env.CATALOG_SYNC_ENABLED;
    expect(isCatalogSyncEnabled()).toBe(false);

    if (orig !== undefined) process.env.CATALOG_SYNC_ENABLED = orig;
  });
});
