/**
 * Tests for ZuperClient.getScheduledJobsInWindow — the job-lookup helper that
 * replaced the broken search behind false "no job found" reschedule bug reports.
 *
 * Regression guard: the original code passed bare `from_date`/`to_date` (which
 * Zuper ignores) and capped at 500 of ~5.4k jobs, so real jobs were missed.
 * This helper must use `filter.from_date`/`filter.to_date` and paginate.
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

describe("ZuperClient.getScheduledJobsInWindow", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.ZUPER_API_KEY = "test-key";
  });

  it("queries Zuper with filter.from_date/filter.to_date (not the ignored bare params)", async () => {
    mockFetchSequence([[job("a", "PROJ-1")]]); // short page → stops after page 1
    const client = new ZuperClient();

    await client.getScheduledJobsInWindow("2026-01-01", "2026-06-30", { pageSize: 100 });

    expect(calls).toHaveLength(1);
    const url = calls[0].url;
    expect(url).toContain("filter.from_date=2026-01-01");
    expect(url).toContain("filter.to_date=2026-06-30");
    // The broken originals must NOT appear as standalone filters.
    expect(url).not.toMatch(/[?&]from_date=/);
    expect(url).not.toMatch(/[?&]to_date=/);
    expect(url).not.toContain("search=");
  });

  it("paginates until a short (partial) page is returned", async () => {
    mockFetchSequence([
      [job("a", "x"), job("b", "y")], // full page (pageSize 2)
      [job("c", "z")], // short page → stop
    ]);
    const client = new ZuperClient();

    const res = await client.getScheduledJobsInWindow("2026-01-01", "2026-12-31", { pageSize: 2, maxPages: 10 });

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

    const res = await client.getScheduledJobsInWindow("2026-05-01", "2026-07-01", {
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

    await client.getScheduledJobsInWindow("2026-01-01", "2026-12-31", { pageSize: 2, maxPages: 3 });

    expect(calls).toHaveLength(3);
  });
});

// /jobs/unscheduled returns a nested { data: { unscheduled_jobs: [...] } } envelope
// and is paginated (thousands of jobs). getUnscheduledJobs must parse that shape,
// paginate, and early-exit on match — mirroring getScheduledJobsInWindow.
function unscheduledPage(jobs: ZuperJob[]): string {
  return JSON.stringify({ data: { unscheduled_jobs: jobs }, total_records: 9999 });
}

function mockUnscheduledSequence(pages: ZuperJob[][]) {
  let i = 0;
  global.fetch = jest.fn(async (url: string) => {
    calls.push({ url: String(url) });
    const body = unscheduledPage(pages[i] ?? []);
    i += 1;
    return { ok: true, status: 200, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("ZuperClient.getUnscheduledJobs", () => {
  beforeEach(() => {
    calls.length = 0;
    process.env.ZUPER_API_KEY = "test-key";
  });

  it("parses data.unscheduled_jobs and paginates until a short page", async () => {
    mockUnscheduledSequence([
      [job("a", "x"), job("b", "y")], // full page (pageSize 2)
      [job("c", "z")], // short page → stop
    ]);
    const client = new ZuperClient();

    const res = await client.getUnscheduledJobs({ pageSize: 2, maxPages: 10 });

    expect(res.type).toBe("success");
    expect((res.data as ZuperJob[]).map((j) => j.job_uid)).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/jobs/unscheduled");
  });

  it("early-exits as soon as the match predicate is satisfied", async () => {
    mockUnscheduledSequence([
      [job("a", "Smith"), job("b", "PROJ-9949 | Montiview")], // match on page 1
      [job("c", "should-not-fetch")],
    ]);
    const client = new ZuperClient();

    const res = await client.getUnscheduledJobs({
      pageSize: 2,
      match: (j) => (j.job_title || "").includes("PROJ-9949"),
    });

    expect(calls).toHaveLength(1); // stopped after the matching page
    expect((res.data as ZuperJob[]).some((j) => j.job_title?.includes("Montiview"))).toBe(true);
  });
});
