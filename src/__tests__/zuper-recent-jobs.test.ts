/**
 * Tests for ZuperClient.getRecentJobs — the newest-first job-lookup helper
 * behind reschedule lookups.
 *
 * Regression guard: the original lookup fetched a fixed 270-day window capped at
 * 500 of ~5.4k jobs and silently missed jobs created moments before a reschedule
 * request (the root of false "no job found" bug reports). getRecentJobs must sort
 * newest-first via Zuper's `filter.sort_by`/`filter.order` (the bare params are
 * ignored), paginate, and early-exit on match.
 */
// zuper.ts statically imports db + zuper-property-sync, which pull in the
// generated Prisma client (ESM `import.meta`, unparseable by Jest's CJS
// transform). Mock them out — this suite only exercises the HTTP helper.
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/zuper-property-sync", () => ({ linkJobToProperty: jest.fn() }));

import { ZuperClient, type ZuperJob } from "@/lib/zuper";

type FetchArgs = { url: string };
const calls: FetchArgs[] = [];

function jobPage(jobs: ZuperJob[]): string {
  return JSON.stringify({ type: "success", data: jobs, total_records: 9999 });
}

function mockFetchSequence(pages: ZuperJob[][]) {
  let i = 0;
  global.fetch = jest.fn(async (url: string) => {
    calls.push({ url: String(url) });
    const body = jobPage(pages[i] ?? []);
    i += 1;
    return {
      ok: true,
      status: 200,
      text: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const job = (uid: string, title: string): ZuperJob => ({ job_uid: uid, job_title: title });

describe("ZuperClient.getRecentJobs", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.ZUPER_API_KEY = "test-key";
  });

  it("sorts newest-first via filter.sort_by/filter.order (not the ignored bare params)", async () => {
    mockFetchSequence([[job("a", "PROJ-1")]]); // short page → stops after page 1
    const client = new ZuperClient();

    await client.getRecentJobs({ pageSize: 100 });

    expect(calls).toHaveLength(1);
    const url = calls[0].url;
    expect(url).toContain("filter.sort_by=created_at");
    expect(url).toContain("filter.order=desc");
    // The ignored bare params must NOT appear as standalone filters.
    expect(url).not.toMatch(/[?&]sort_by=/);
    expect(url).not.toMatch(/[?&]order=/);
  });

  it("paginates until a short (partial) page is returned", async () => {
    mockFetchSequence([
      [job("a", "x"), job("b", "y")], // full page (pageSize 2)
      [job("c", "z")], // short page → stop
    ]);
    const client = new ZuperClient();

    const res = await client.getRecentJobs({ pageSize: 2, maxPages: 10 });

    expect(res.type).toBe("success");
    expect((res.data as ZuperJob[]).map((j) => j.job_uid)).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
  });

  it("early-exits as soon as the match predicate is satisfied", async () => {
    mockFetchSequence([
      [job("a", "Smith"), job("b", "PROJ-9912 | Downs, Sam")], // match on page 1
      [job("c", "should-not-fetch")],
    ]);
    const client = new ZuperClient();

    const res = await client.getRecentJobs({
      pageSize: 2,
      match: (j) => (j.job_title || "").includes("PROJ-9912"),
    });

    expect(calls).toHaveLength(1); // stopped after the matching page
    expect((res.data as ZuperJob[]).some((j) => j.job_title?.includes("Downs"))).toBe(true);
  });

  it("respects maxPages as a runaway guard", async () => {
    // Always return a full page so it would paginate forever without the cap.
    global.fetch = jest.fn(async (url: string) => {
      calls.push({ url: String(url) });
      return {
        ok: true,
        status: 200,
        text: async () => jobPage([job("p", "full"), job("q", "full")]),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = new ZuperClient();

    await client.getRecentJobs({ pageSize: 2, maxPages: 3 });

    expect(calls).toHaveLength(3);
  });
});
