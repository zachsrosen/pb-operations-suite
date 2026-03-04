import {
  createDedupConfirmationToken,
  validateDedupConfirmationToken,
  buildDedupConfirmation,
  hashToken,
  DEDUP_CONFIRM_TTL_MS,
  DEDUP_MAX_DELETES,
} from "@/lib/catalog-dedup-confirmation";

const TEST_SECRET = "test-secret-at-least-32-chars-long-for-hmac";

beforeAll(() => {
  process.env.PRODUCT_CLEANUP_CONFIRM_SECRET = TEST_SECRET;
});

describe("catalog-dedup-confirmation", () => {
  const clusters = [
    { keepId: "item_keep_1", deleteIds: ["item_del_1", "item_del_2"] },
    { keepId: "item_keep_2", deleteIds: ["item_del_3"] },
  ];

  it("creates and validates a token round-trip", () => {
    const issuedAt = Date.now();
    const token = createDedupConfirmationToken(
      { clusters, issuedAt },
      TEST_SECRET,
    );

    const result = validateDedupConfirmationToken({ token, issuedAt, clusters });
    expect(result).toEqual({ ok: true });
  });

  it("is deterministic for same input (order independent)", () => {
    const issuedAt = Date.now();
    const token1 = createDedupConfirmationToken(
      { clusters: [clusters[1], clusters[0]], issuedAt },
      TEST_SECRET,
    );
    const token2 = createDedupConfirmationToken(
      { clusters: [clusters[0], clusters[1]], issuedAt },
      TEST_SECRET,
    );
    expect(token1).toBe(token2);
  });

  it("rejects expired tokens", () => {
    const issuedAt = Date.now() - DEDUP_CONFIRM_TTL_MS - 1000;
    const token = createDedupConfirmationToken(
      { clusters, issuedAt },
      TEST_SECRET,
    );

    const result = validateDedupConfirmationToken({ token, issuedAt, clusters });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
  });

  it("rejects tampered cluster decisions", () => {
    const issuedAt = Date.now();
    const token = createDedupConfirmationToken(
      { clusters, issuedAt },
      TEST_SECRET,
    );

    // Swap a delete ID
    const tampered = [
      { keepId: "item_keep_1", deleteIds: ["item_del_1", "item_del_DIFFERENT"] },
      { keepId: "item_keep_2", deleteIds: ["item_del_3"] },
    ];
    const result = validateDedupConfirmationToken({ token, issuedAt, clusters: tampered });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid/i);
  });

  it("rejects when total deletes exceed max", () => {
    const bigClusters = [{
      keepId: "keep_1",
      deleteIds: Array.from({ length: DEDUP_MAX_DELETES + 1 }, (_, i) => `del_${i}`),
    }];
    const issuedAt = Date.now();
    const token = createDedupConfirmationToken(
      { clusters: bigClusters, issuedAt },
      TEST_SECRET,
    );

    const result = validateDedupConfirmationToken({ token, issuedAt, clusters: bigClusters });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maximum/i);
  });

  it("buildDedupConfirmation returns token, issuedAt, expiresAt", () => {
    const result = buildDedupConfirmation({ clusters });
    expect(result.token).toBeTruthy();
    expect(typeof result.issuedAt).toBe("number");
    expect(result.expiresAt).toBe(result.issuedAt + DEDUP_CONFIRM_TTL_MS);
  });

  it("buildDedupConfirmation rejects over-limit clusters", () => {
    const bigClusters = [{
      keepId: "keep_1",
      deleteIds: Array.from({ length: DEDUP_MAX_DELETES + 1 }, (_, i) => `del_${i}`),
    }];
    expect(() => buildDedupConfirmation({ clusters: bigClusters })).toThrow(/maximum/i);
  });

  it("hashToken produces consistent SHA-256 hex", () => {
    const h1 = hashToken("test-token");
    const h2 = hashToken("test-token");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex length
  });

  it("hashToken differs for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});
