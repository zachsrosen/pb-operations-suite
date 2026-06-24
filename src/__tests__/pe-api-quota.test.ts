import {
  isDailyQuotaError,
  parseQuotaResetAt,
  fetchWithRetry,
  projectNeedsActionItemDetail,
  selectDetailFetchIds,
  quotaBlockActive,
} from "@/lib/pe-api";

const QUOTA_BODY = JSON.stringify({
  success: false,
  error: {
    code: "QUOTA_EXCEEDED",
    message: "Daily quota exceeded: dailyApiCalls",
    details: [{ quotaType: "dailyApiCalls", limit: 5000, used: 5000, resetsAt: "2026-06-22T00:00:00.000Z" }],
  },
});

describe("isDailyQuotaError", () => {
  it("detects the PE daily-quota error body", () => {
    expect(isDailyQuotaError(QUOTA_BODY)).toBe(true);
    expect(isDailyQuotaError('{"error":{"code":"QUOTA_EXCEEDED"}}')).toBe(true);
    expect(isDailyQuotaError("...dailyApiCalls...")).toBe(true);
  });
  it("is false for a transient rate-limit or unrelated body", () => {
    expect(isDailyQuotaError('{"error":{"code":"RATE_LIMITED"}}')).toBe(false);
    expect(isDailyQuotaError("Too Many Requests")).toBe(false);
    expect(isDailyQuotaError("")).toBe(false);
  });
});

describe("parseQuotaResetAt", () => {
  it("extracts resetsAt from the quota error body", () => {
    expect(parseQuotaResetAt(QUOTA_BODY)).toBe("2026-06-22T00:00:00.000Z");
  });
  it("returns null when absent or unparseable", () => {
    expect(parseQuotaResetAt("{}")).toBeNull();
    expect(parseQuotaResetAt("not json")).toBeNull();
  });
});

describe("fetchWithRetry", () => {
  const res = (status: number, body = "", headers: Record<string, string> = {}) =>
    new Response(body, { status, headers });

  afterEach(() => jest.restoreAllMocks());

  it("returns immediately on a successful response (one call)", async () => {
    const spy = jest.spyOn(global, "fetch").mockResolvedValue(res(200, "ok"));
    const r = await fetchWithRetry("http://x", {});
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a daily-quota 429 (one call, returns the 429)", async () => {
    const spy = jest.spyOn(global, "fetch").mockResolvedValue(res(429, QUOTA_BODY));
    const r = await fetchWithRetry("http://x", {}, 3);
    expect(r.status).toBe(429);
    expect(spy).toHaveBeenCalledTimes(1); // not 1 + retries
  });

  it("does not fire an EXTRA trailing fetch when retries are exhausted (retries=0 => exactly 1 call)", async () => {
    const spy = jest.spyOn(global, "fetch").mockResolvedValue(res(500, "boom"));
    const r = await fetchWithRetry("http://x", {}, 0);
    expect(r.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1); // old bug returned a 2nd fetch after the loop
  });

  it("retries a transient (non-quota) 429 then returns success", async () => {
    const spy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(res(429, "slow down", { "Retry-After": "0" }))
      .mockResolvedValueOnce(res(200, "ok"));
    const r = await fetchWithRetry("http://x", {}, 2);
    expect(r.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 4xx client errors", async () => {
    const spy = jest.spyOn(global, "fetch").mockResolvedValue(res(404, "nope"));
    const r = await fetchWithRetry("http://x", {}, 3);
    expect(r.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("projectNeedsActionItemDetail", () => {
  const doc = (status: string | null) => ({ present: true, version: 1, status });
  it("is true when any doc is RESPONSE_NEEDED (only those need a detail fetch for action items)", () => {
    expect(projectNeedsActionItemDetail({ documents: { designPlan: doc("APPROVED"), photos: doc("RESPONSE_NEEDED") } })).toBe(true);
  });
  it("is false when no doc is RESPONSE_NEEDED (status + versions come from the cheap list)", () => {
    expect(projectNeedsActionItemDetail({ documents: { designPlan: doc("APPROVED"), photos: doc("PENDING_REVIEW"), utilityBill: doc(null) } })).toBe(false);
  });
  it("is false for an empty documents object", () => {
    expect(projectNeedsActionItemDetail({ documents: {} })).toBe(false);
  });
});

describe("quotaBlockActive", () => {
  const now = Date.parse("2026-06-21T18:00:00Z");
  it("is true when blockedUntil is in the future", () => {
    expect(quotaBlockActive("2026-06-22T00:00:00Z", now)).toBe(true);
  });
  it("is false when blockedUntil has passed", () => {
    expect(quotaBlockActive("2026-06-21T12:00:00Z", now)).toBe(false);
  });
  it("is false for null/empty/unparseable", () => {
    expect(quotaBlockActive(null, now)).toBe(false);
    expect(quotaBlockActive(undefined, now)).toBe(false);
    expect(quotaBlockActive("nonsense", now)).toBe(false);
  });
});

describe("selectDetailFetchIds", () => {
  const proj = (id: string, projectId: string, updatedAt?: string | null) => ({
    id,
    projectId,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  });

  it("pulls detail for a fresh rejection with no captured note", () => {
    const ids = selectDetailFetchIds([proj("int-1", "CO-1", "2026-06-24T05:00:00Z")], new Map());
    expect(ids).toEqual(["int-1"]);
  });

  it("skips a rejection already captured and unchanged since", () => {
    const captured = new Map([["CO-1", Date.parse("2026-06-24T05:00:00Z")]]);
    const ids = selectDetailFetchIds([proj("int-1", "CO-1", "2026-06-24T04:00:00Z")], captured);
    expect(ids).toEqual([]);
  });

  it("re-pulls a captured rejection PE changed (updatedAt after capture)", () => {
    const captured = new Map([["CO-1", Date.parse("2026-06-24T04:00:00Z")]]);
    const ids = selectDetailFetchIds([proj("int-1", "CO-1", "2026-06-24T06:30:00Z")], captured);
    expect(ids).toEqual(["int-1"]);
  });

  it("skips a captured rejection with no updatedAt (cannot prove a change)", () => {
    const captured = new Map([["CO-1", Date.parse("2026-06-24T04:00:00Z")]]);
    const ids = selectDetailFetchIds([proj("int-1", "CO-1", null)], captured);
    expect(ids).toEqual([]);
  });

  it("handles a mixed batch: fresh + changed pulled, captured-stable skipped", () => {
    const captured = new Map([
      ["CO-A", Date.parse("2026-06-24T04:00:00Z")], // stable
      ["CO-B", Date.parse("2026-06-24T04:00:00Z")], // will be changed
    ]);
    const batch = [
      proj("int-A", "CO-A", "2026-06-24T03:00:00Z"), // unchanged → skip
      proj("int-B", "CO-B", "2026-06-24T07:00:00Z"), // changed → pull
      proj("int-C", "CO-C", "2026-06-24T07:00:00Z"), // never captured → pull
    ];
    expect(selectDetailFetchIds(batch, captured).sort()).toEqual(["int-B", "int-C"]);
  });
});
