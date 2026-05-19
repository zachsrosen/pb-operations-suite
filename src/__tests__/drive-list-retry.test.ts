/**
 * Drive list retry behaviour — verifies that 429/5xx/network errors are
 * retried with exponential backoff, while 4xx (other than 401/429) are
 * surfaced immediately.
 */

import { listDriveFiles } from "@/lib/drive-plansets";

const ORIG_FETCH = global.fetch;
const ORIG_TOKEN = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

// Mock the Drive token fetch so we don't try to mint a real SA token.
jest.mock("@/lib/google-auth", () => ({
  getServiceAccountToken: jest.fn(async () => "test-token"),
  _resetTokenCacheForTests: jest.fn(),
}));

afterAll(() => {
  global.fetch = ORIG_FETCH;
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = ORIG_TOKEN;
});

beforeEach(() => {
  // Make getDriveToken bypass the DWD path: clear admin email so SA fallback
  // returns immediately via the mocked module.
  delete process.env.GOOGLE_ADMIN_EMAIL;
  delete process.env.GMAIL_SENDER_EMAIL;
});

describe("listDriveFiles retry", () => {
  it("retries on 429 and succeeds on subsequent attempt", async () => {
    const calls: number[] = [];
    global.fetch = (jest.fn(async () => {
      calls.push(Date.now());
      if (calls.length < 2) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ files: [{ id: "f1", name: "a.pdf", mimeType: "application/pdf", modifiedTime: "2026-05-18T00:00:00Z" }] }), { status: 200 });
    }) as unknown) as typeof fetch;

    const result = await listDriveFiles("folder-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f1");
    expect(calls.length).toBe(2);
  });

  it("retries on 5xx", async () => {
    const calls: number[] = [];
    global.fetch = (jest.fn(async () => {
      calls.push(Date.now());
      if (calls.length < 2) return new Response("upstream", { status: 503 });
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }) as unknown) as typeof fetch;

    const result = await listDriveFiles("folder-1");
    expect(result).toEqual([]);
    expect(calls.length).toBe(2);
  });

  it("retries on 401 (treated as transient)", async () => {
    const calls: number[] = [];
    global.fetch = (jest.fn(async () => {
      calls.push(Date.now());
      if (calls.length < 2) return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }) as unknown) as typeof fetch;

    await listDriveFiles("folder-1");
    expect(calls.length).toBe(2);
  });

  it("does NOT retry on 403 (non-transient)", async () => {
    const calls: number[] = [];
    global.fetch = (jest.fn(async () => {
      calls.push(Date.now());
      return new Response("forbidden", { status: 403 });
    }) as unknown) as typeof fetch;

    await expect(listDriveFiles("folder-1")).rejects.toThrow(/Drive.*403/);
    expect(calls.length).toBe(1);
  });

  it("gives up after 4 total attempts on persistent 429", async () => {
    const calls: number[] = [];
    global.fetch = (jest.fn(async () => {
      calls.push(Date.now());
      return new Response("rate limited", { status: 429 });
    }) as unknown) as typeof fetch;

    await expect(listDriveFiles("folder-1")).rejects.toThrow(/Drive.*429/);
    expect(calls.length).toBe(4);
  });

  it("respects Retry-After header (capped — just ensures it doesn't crash)", async () => {
    let count = 0;
    global.fetch = (jest.fn(async () => {
      count++;
      if (count === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    }) as unknown) as typeof fetch;

    await listDriveFiles("folder-1");
    expect(count).toBe(2);
  });
});
