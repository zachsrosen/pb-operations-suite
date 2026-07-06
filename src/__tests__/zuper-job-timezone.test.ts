/**
 * Tests for per-job timezone stamping on Zuper jobs.
 *
 * Bug: jobs created/rescheduled through the Ops Suite never set Zuper's
 * `job_timezone` field, so Zuper renders scheduled times (UI + customer
 * notifications) in the account timezone (Mountain). Pacific customers got
 * appointment notifications showing Mountain wall-clock times.
 *
 * Fix: stamp `job_timezone` on create (from schedule.timezone or the project
 * state) and on reschedule (explicit arg or derived from the job's customer
 * address). The scheduled datetimes themselves stay UTC — job_timezone is a
 * display/notification tag, not a time shift.
 */
// zuper.ts statically imports db + zuper-property-sync, which pull in the
// generated Prisma client (ESM `import.meta`, unparseable by Jest's CJS
// transform). Mock them out — these suites only exercise the HTTP payloads.
export {}; // module scope — keeps top-level helpers from colliding across test files

jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/zuper-property-sync", () => ({ linkJobToProperty: jest.fn() }));
jest.mock("@/lib/zuper-call-counter", () => ({ recordZuperCall: jest.fn() }));

type RecordedCall = {
  url: string;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};

const calls: RecordedCall[] = [];

/** Mock global.fetch; handler returns the JSON payload for each request. */
function mockFetch(handler: (url: string, method: string) => unknown) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const method = String(init?.method || "GET");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), method, body });
    const payload = handler(String(url), method);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const putScheduleCalls = () =>
  calls.filter((c) => c.method === "PUT" && c.url.includes("/jobs/schedule"));
const postJobCalls = () =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith("/jobs"));

// The `zuper` singleton reads ZUPER_API_KEY at module load, so set env
// before importing the module.
let zuperMod: typeof import("@/lib/zuper");

beforeAll(async () => {
  process.env.ZUPER_API_KEY = "test-key";
  process.env.ZUPER_API_URL = "https://zuper.test/api";
  zuperMod = await import("@/lib/zuper");
});

beforeEach(() => {
  calls.length = 0;
});

describe("zuperTimezoneForState", () => {
  it("maps CA / California to Pacific", () => {
    expect(zuperMod.zuperTimezoneForState("CA")).toBe("America/Los_Angeles");
    expect(zuperMod.zuperTimezoneForState("California")).toBe("America/Los_Angeles");
    expect(zuperMod.zuperTimezoneForState("california ")).toBe("America/Los_Angeles");
  });

  it("defaults everything else to Denver", () => {
    expect(zuperMod.zuperTimezoneForState("CO")).toBe("America/Denver");
    expect(zuperMod.zuperTimezoneForState("Colorado")).toBe("America/Denver");
    expect(zuperMod.zuperTimezoneForState("")).toBe("America/Denver");
    expect(zuperMod.zuperTimezoneForState(undefined)).toBe("America/Denver");
  });
});

describe("ZuperClient.rescheduleJob job_timezone", () => {
  const JOB_UID = "job-tz-test";
  const START = "2026-07-13T16:00:00.000Z";
  const END = "2026-07-13T17:00:00.000Z";
  const NEW_START = "2026-07-13T18:00:00.000Z";
  const NEW_END = "2026-07-13T19:00:00.000Z";

  function jobDetail(overrides: Record<string, unknown> = {}) {
    return {
      type: "success",
      data: {
        job_uid: JOB_UID,
        job_title: "PROJ-10029 | Robinson, Lynn",
        scheduled_start_time: START,
        scheduled_end_time: END,
        job_timezone: null,
        customer_address: {
          street: "946 Calle Cortita",
          city: "Santa Barbara",
          state: "California",
          zip_code: "93109",
        },
        ...overrides,
      },
    };
  }

  function mockJobApis(detail: unknown) {
    mockFetch((url, method) => {
      if (method === "PUT" && url.includes("/jobs/schedule")) {
        return { type: "success", message: "Job has been updated successfully" };
      }
      if (method === "GET" && url.includes(`/jobs/${JOB_UID}`)) {
        return detail;
      }
      return { type: "success", data: {} };
    });
  }

  it("sends an explicitly provided timezone in the PUT body", async () => {
    mockJobApis(jobDetail());
    const client = new zuperMod.ZuperClient();
    const result = await client.rescheduleJob(
      JOB_UID,
      NEW_START,
      NEW_END,
      undefined,
      undefined,
      "America/Los_Angeles"
    );
    expect(result.type).toBe("success");
    const puts = putScheduleCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0].body.job_timezone).toBe("America/Los_Angeles");
  });

  it("derives the timezone from the job's customer address when not provided", async () => {
    mockJobApis(jobDetail());
    const client = new zuperMod.ZuperClient();
    await client.rescheduleJob(JOB_UID, NEW_START, NEW_END);
    const puts = putScheduleCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0].body.job_timezone).toBe("America/Los_Angeles");
  });

  it("still PUTs when times are unchanged but the job is missing its timezone", async () => {
    mockJobApis(jobDetail());
    const client = new zuperMod.ZuperClient();
    // Same times as the prefetched job → previously skipped entirely.
    await client.rescheduleJob(JOB_UID, START, END);
    const puts = putScheduleCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0].body.job_timezone).toBe("America/Los_Angeles");
  });

  it("skips the PUT when times are unchanged and the timezone already matches", async () => {
    mockJobApis(jobDetail({ job_timezone: "America/Los_Angeles" }));
    const client = new zuperMod.ZuperClient();
    await client.rescheduleJob(JOB_UID, START, END);
    expect(putScheduleCalls()).toHaveLength(0);
  });

  it("omits job_timezone when it cannot be determined", async () => {
    mockJobApis(jobDetail({ customer_address: undefined }));
    const client = new zuperMod.ZuperClient();
    await client.rescheduleJob(JOB_UID, NEW_START, NEW_END);
    const puts = putScheduleCalls();
    expect(puts).toHaveLength(1);
    expect("job_timezone" in puts[0].body).toBe(false);
  });
});

describe("createJobFromProject job_timezone", () => {
  const project = {
    id: "12345",
    name: "PROJ-9999 | Test, Customer | 123 Main St",
    address: "123 Main St",
    city: "Santa Barbara",
    state: "CA",
    zipCode: "93109",
    customerName: "Test Customer",
  };

  function mockCreateApis() {
    mockFetch((url, method) => {
      if (method === "POST" && url.endsWith("/jobs")) {
        return { type: "success", data: { job_uid: "new-job-uid" } };
      }
      if (url.includes("/customers")) {
        return {
          type: "success",
          data: [
            {
              customer_uid: "cust-1",
              customer_first_name: "Test",
              customer_last_name: "Customer",
            },
          ],
        };
      }
      return { type: "success", data: {} };
    });
  }

  const baseSchedule = {
    type: "survey" as const,
    date: "2026-07-20",
    days: 1,
    startTime: "08:00",
    endTime: "09:00",
  };

  it("uses the explicit schedule timezone when provided", async () => {
    mockCreateApis();
    await zuperMod.createJobFromProject(project, {
      ...baseSchedule,
      timezone: "America/Los_Angeles",
    });
    const posts = postJobCalls();
    expect(posts).toHaveLength(1);
    expect(posts[0].body.job.job_timezone).toBe("America/Los_Angeles");
  });

  it("derives the timezone from the project state when not provided", async () => {
    mockCreateApis();
    await zuperMod.createJobFromProject(project, { ...baseSchedule });
    const posts = postJobCalls();
    expect(posts).toHaveLength(1);
    expect(posts[0].body.job.job_timezone).toBe("America/Los_Angeles");
  });

  it("defaults to Denver for Colorado projects", async () => {
    mockCreateApis();
    await zuperMod.createJobFromProject(
      { ...project, state: "CO", city: "Denver" },
      { ...baseSchedule }
    );
    const posts = postJobCalls();
    expect(posts).toHaveLength(1);
    expect(posts[0].body.job.job_timezone).toBe("America/Denver");
  });
});
