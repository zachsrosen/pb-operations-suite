import {
  createAdminActionToken,
  validateAdminActionToken,
  getAdminActionSecret,
} from "@/lib/admin-action-confirmation";

const TEST_SECRET = "test-secret-at-least-32-chars-long-for-hmac";

describe("admin-action-confirmation", () => {
  it("creates and validates a token round-trip", () => {
    const payload = { action: "override_create", skuIds: ["sku_1"] };
    const issuedAt = Date.now();
    const token = createAdminActionToken(
      { payload, issuedAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload,
      issuedAt,
      secret: TEST_SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects expired tokens", () => {
    const payload = { action: "test" };
    const issuedAt = Date.now() - 6 * 60_000; // 6 minutes ago
    const token = createAdminActionToken(
      { payload, issuedAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload,
      issuedAt,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
  });

  it("rejects tampered payload", () => {
    const issuedAt = Date.now();
    const token = createAdminActionToken(
      { payload: { action: "original" }, issuedAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload: { action: "tampered" },
      issuedAt,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid/i);
  });

  it("rejects future issuedAt", () => {
    const futureAt = Date.now() + 5 * 60_000;
    const token = createAdminActionToken(
      { payload: { x: 1 }, issuedAt: futureAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload: { x: 1 },
      issuedAt: futureAt,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/future/i);
  });

  it("getAdminActionSecret falls back through env vars", () => {
    const original = process.env.ADMIN_ACTION_SECRET;
    process.env.ADMIN_ACTION_SECRET = "my-secret";
    expect(getAdminActionSecret()).toBe("my-secret");
    if (original) {
      process.env.ADMIN_ACTION_SECRET = original;
    } else {
      delete process.env.ADMIN_ACTION_SECRET;
    }
  });
});
