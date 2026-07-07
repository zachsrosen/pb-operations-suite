/**
 * Tests for the `create-zuper-job` admin-workflow action.
 *
 * The action creates an UNSCHEDULED Zuper job (due date only, no
 * scheduled_start_time) for a HubSpot deal, in a caller-chosen category —
 * e.g. Additional Visit. Zuper renders times in job_timezone, so the action
 * must stamp it from the deal's state (CA → Pacific, else Mountain).
 */
export {}; // module scope — keeps top-level helpers from colliding across test files

jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/zuper-property-sync", () => ({ linkJobToProperty: jest.fn() }));
jest.mock("@/lib/zuper-call-counter", () => ({ recordZuperCall: jest.fn() }));

// The action reads deal properties through the shared HubSpot helper.
const mockGetDealProperties = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  getDealProperties: (...args: unknown[]) => mockGetDealProperties(...args),
}));

type RecordedCall = {
  url: string;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
};

const calls: RecordedCall[] = [];

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

const postJobCalls = () =>
  calls.filter((c) => c.method === "POST" && c.url.endsWith("/jobs"));

let action: typeof import("@/lib/admin-workflows/actions/create-zuper-job").createZuperJobAction;

const ADDITIONAL_VISIT_UID = "d83c054f-69c1-470c-964c-2b79e88258f4";

beforeAll(async () => {
  process.env.ZUPER_API_KEY = "test-key";
  process.env.ZUPER_API_URL = "https://zuper.test/api";
  ({ createZuperJobAction } = await import("@/lib/admin-workflows/actions/create-zuper-job"));
  action = createZuperJobAction;
});
// eslint-disable-next-line prefer-const
let createZuperJobAction: typeof action;

const context = {
  runId: "run-1",
  workflowId: "wf-1",
  stepId: "create-job",
  triggerContext: {},
  previousOutputs: {},
  triggeredByEmail: "zach@photonbrothers.com",
};

function mockDeal(overrides: Record<string, string | null> = {}) {
  mockGetDealProperties.mockResolvedValue({
    dealname: "PROJ-9999 | Test, Customer | 123 Main St, Santa Barbara, CA 93109",
    address_line_1: "123 Main St",
    city: "Santa Barbara",
    state: "CA",
    postal_code: "93109",
    ...overrides,
  });
}

function mockZuperApis(opts: { projects?: unknown[] } = {}) {
  mockFetch((url, method) => {
    if (method === "POST" && url.endsWith("/jobs")) {
      return { type: "success", data: { job_uid: "new-job-uid" } };
    }
    if (url.includes("/projects?")) {
      return { type: "success", data: opts.projects ?? [] };
    }
    if (method === "POST" && /\/projects\/[^/]+\/jobs\//.test(url)) {
      return { type: "success", message: "Job added to project" };
    }
    if (url.includes("/customers")) {
      return {
        type: "success",
        data: [
          { customer_uid: "cust-1", customer_first_name: "Test", customer_last_name: "Customer" },
        ],
      };
    }
    return { type: "success", data: {} };
  });
}

const projectLinkCalls = () =>
  calls.filter((c) => c.method === "POST" && /\/projects\/[^/]+\/jobs\//.test(c.url));

beforeEach(() => {
  calls.length = 0;
  mockGetDealProperties.mockReset();
});

describe("create-zuper-job action", () => {
  it("creates an unscheduled job with the requested category and Pacific timezone for CA deals", async () => {
    mockDeal();
    mockZuperApis();

    const output = await action.handler({
      inputs: action.inputsSchema.parse({
        dealId: "54787360530",
        jobCategoryUid: ADDITIONAL_VISIT_UID,
        jobDescription: "Xcel rejected PTO photos — return trip needed.",
      }),
      context,
    });

    const posts = postJobCalls();
    expect(posts).toHaveLength(1);
    const job = posts[0].body.job;
    expect(job.job_category).toBe(ADDITIONAL_VISIT_UID);
    expect(job.job_timezone).toBe("America/Los_Angeles");
    expect(job.job_description).toContain("Xcel rejected");
    // Unscheduled: a due date but NO scheduled times.
    expect(job.due_date).toBeTruthy();
    expect(job.scheduled_start_time).toBeUndefined();
    expect(job.scheduled_end_time).toBeUndefined();
    // Deal linkage for humans + the Link Deal to Zuper Job HubSpot workflow.
    expect(job.job_tags).toContain("hubspot-54787360530");
    expect(job.custom_fields.hubspot_deal_id).toBe("54787360530");

    expect(output.jobUid).toBe("new-job-uid");
    expect(output.jobUrl).toContain("new-job-uid");
  });

  it("defaults the title from the deal name and stamps Mountain timezone for CO deals", async () => {
    mockDeal({
      dealname: "PROJ-1234 | Boulder, Bob | 1 Pearl St, Boulder, CO 80302",
      city: "Boulder",
      state: "CO",
      address_line_1: "1 Pearl St",
      postal_code: "80302",
    });
    mockZuperApis();

    await action.handler({
      inputs: action.inputsSchema.parse({
        dealId: "111",
        jobCategoryUid: ADDITIONAL_VISIT_UID,
      }),
      context,
    });

    const job = postJobCalls()[0].body.job;
    expect(job.job_timezone).toBe("America/Denver");
    expect(job.job_title).toContain("PROJ-1234");
  });

  it("uses an explicit title when provided", async () => {
    mockDeal();
    mockZuperApis();

    await action.handler({
      inputs: action.inputsSchema.parse({
        dealId: "222",
        jobCategoryUid: ADDITIONAL_VISIT_UID,
        jobTitle: "Custom title here",
      }),
      context,
    });

    expect(postJobCalls()[0].body.job.job_title).toBe("Custom title here");
  });

  it("throws a clear error when the deal does not exist", async () => {
    mockGetDealProperties.mockResolvedValue(null);
    mockZuperApis();

    await expect(
      action.handler({
        inputs: action.inputsSchema.parse({
          dealId: "404404",
          jobCategoryUid: ADDITIONAL_VISIT_UID,
        }),
        context,
      })
    ).rejects.toThrow(/404404/);
  });

  it("rejects inputs missing a category", () => {
    const parsed = action.inputsSchema.safeParse({ dealId: "1" });
    expect(parsed.success).toBe(false);
  });

  it("links the job to the deal's Zuper project when one matches by HubSpot Deal ID", async () => {
    mockDeal();
    mockZuperApis({
      projects: [
        {
          project_uid: "proj-uid-1",
          project_title: "Test, Customer | 123 Main St",
          custom_fields: [{ label: "HubSpot Deal ID", value: "54787360530" }],
        },
        {
          project_uid: "proj-uid-other",
          project_title: "Test, Customer | Somewhere Else",
          custom_fields: [{ label: "HubSpot Deal ID", value: "999" }],
        },
      ],
    });

    const output = await action.handler({
      inputs: action.inputsSchema.parse({
        dealId: "54787360530",
        jobCategoryUid: ADDITIONAL_VISIT_UID,
      }),
      context,
    });

    const links = projectLinkCalls();
    expect(links).toHaveLength(1);
    expect(links[0].url).toContain("/projects/proj-uid-1/jobs/new-job-uid");
    expect(output.projectUid).toBe("proj-uid-1");
  });

  it("still succeeds (projectUid null) when no Zuper project matches", async () => {
    mockDeal();
    mockZuperApis({ projects: [] });

    const output = await action.handler({
      inputs: action.inputsSchema.parse({
        dealId: "54787360530",
        jobCategoryUid: ADDITIONAL_VISIT_UID,
      }),
      context,
    });

    expect(projectLinkCalls()).toHaveLength(0);
    expect(output.projectUid).toBeNull();
    expect(output.jobUid).toBe("new-job-uid");
  });
});
