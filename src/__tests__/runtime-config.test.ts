import {
  resolveRuntimeConfig,
  clearRuntimeConfigCache,
} from "@/lib/runtime-config";

describe("resolveRuntimeConfig", () => {
  beforeEach(() => {
    clearRuntimeConfigCache();
    delete process.env.TEST_CFG_A;
    delete process.env.TEST_CFG_B;
  });
  afterEach(() => {
    delete process.env.TEST_CFG_A;
    delete process.env.TEST_CFG_B;
  });

  it("returns the env var when set (no DB read)", async () => {
    process.env.TEST_CFG_A = "from-env";
    const fetchDb = jest.fn(async () => "from-db");
    const v = await resolveRuntimeConfig("k", ["TEST_CFG_A"], fetchDb);
    expect(v).toBe("from-env");
    expect(fetchDb).not.toHaveBeenCalled();
  });

  it("checks env keys in order and uses the first set", async () => {
    process.env.TEST_CFG_B = "second";
    const fetchDb = jest.fn(async () => "from-db");
    const v = await resolveRuntimeConfig("k", ["TEST_CFG_A", "TEST_CFG_B"], fetchDb);
    expect(v).toBe("second");
    expect(fetchDb).not.toHaveBeenCalled();
  });

  it("falls back to the DB value when no env var is set", async () => {
    const fetchDb = jest.fn(async () => "from-db");
    const v = await resolveRuntimeConfig("k", ["TEST_CFG_A"], fetchDb);
    expect(v).toBe("from-db");
    expect(fetchDb).toHaveBeenCalledTimes(1);
  });

  it("caches the DB value within the TTL (single DB read)", async () => {
    const fetchDb = jest.fn(async () => "cached-val");
    const a = await resolveRuntimeConfig("k", [], fetchDb, 1_000);
    const b = await resolveRuntimeConfig("k", [], fetchDb, 1_000 + 30_000); // < 60s
    expect(a).toBe("cached-val");
    expect(b).toBe("cached-val");
    expect(fetchDb).toHaveBeenCalledTimes(1);
  });

  it("re-reads the DB after the TTL expires", async () => {
    const fetchDb = jest
      .fn()
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");
    const a = await resolveRuntimeConfig("k", [], fetchDb, 1_000);
    const b = await resolveRuntimeConfig("k", [], fetchDb, 1_000 + 61_000); // > 60s
    expect(a).toBe("v1");
    expect(b).toBe("v2");
    expect(fetchDb).toHaveBeenCalledTimes(2);
  });

  it("env var still wins even after a DB value was cached", async () => {
    const fetchDb = jest.fn(async () => "from-db");
    await resolveRuntimeConfig("k", ["TEST_CFG_A"], fetchDb); // caches from-db
    process.env.TEST_CFG_A = "from-env";
    const v = await resolveRuntimeConfig("k", ["TEST_CFG_A"], fetchDb);
    expect(v).toBe("from-env");
  });

  it("serves the last cached value if a later DB read throws", async () => {
    const fetchDb = jest
      .fn()
      .mockResolvedValueOnce("good")
      .mockRejectedValueOnce(new Error("db down"));
    const a = await resolveRuntimeConfig("k", [], fetchDb, 1_000);
    const b = await resolveRuntimeConfig("k", [], fetchDb, 1_000 + 61_000);
    expect(a).toBe("good");
    expect(b).toBe("good"); // fell back to cache on error
  });

  it("returns undefined when neither env nor DB provides a value", async () => {
    const fetchDb = jest.fn(async () => undefined);
    const v = await resolveRuntimeConfig("k", ["TEST_CFG_A"], fetchDb);
    expect(v).toBeUndefined();
  });
});
