const mockBetaZodTool = jest.fn((options) => options);
jest.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (options: unknown) => mockBetaZodTool(options),
}));

const mockRunChecks = jest.fn();
jest.mock("@/lib/checks/runner", () => ({
  runChecks: (...args: unknown[]) => mockRunChecks(...args),
}));

jest.mock("@/lib/checks/design-review", () => ({}));

const mockGetById = jest.fn();
const mockSearchWithRetry = jest.fn();
const mockFetchAllProjects = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      deals: {
        basicApi: {
          getById: (...args: unknown[]) => mockGetById(...args),
        },
      },
    },
  },
  DEAL_STAGE_MAP: {
    "20440342": "Construction",
    "20461937": "Design & Engineering",
  },
  searchWithRetry: (...args: unknown[]) => mockSearchWithRetry(...args),
  fetchAllProjects: (...args: unknown[]) => mockFetchAllProjects(...args),
}));

const mockAcquireReviewLock = jest.fn();
const mockCompleteReviewRun = jest.fn();
const mockFailReviewRun = jest.fn();

jest.mock("@/lib/review-lock", () => {
  const { DuplicateReviewError } = jest.requireActual("@/lib/review-lock");
  return {
    acquireReviewLock: (...args: unknown[]) => mockAcquireReviewLock(...args),
    completeReviewRun: (...args: unknown[]) => mockCompleteReviewRun(...args),
    failReviewRun: (...args: unknown[]) => mockFailReviewRun(...args),
    DuplicateReviewError,
  };
});

jest.mock("@/lib/db", () => ({
  prisma: {
    projectReview: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import { createChatTools } from "@/lib/chat-tools";
import { DuplicateReviewError } from "@/lib/review-lock";

type ToolLike = {
  name: string;
  run: (input: Record<string, unknown>) => Promise<string>;
};

function getTool(name: string, role = "ADMIN"): ToolLike {
  const tools = createChatTools({ email: "admin@test.com", role }) as unknown as ToolLike[];
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("createChatTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers all seven tools", () => {
    const tools = createChatTools({ email: "admin@test.com", role: "ADMIN" }) as unknown as ToolLike[];
    expect(tools.map((t) => t.name)).toEqual([
      "get_deal",
      "get_review_results",
      "search_deals",
      "run_review",
      "get_review_status",
      "filter_deals_by_stage",
      "count_deals_by_stage",
    ]);
  });

  it("blocks run_review when caller role is not allowed for the requested skill", async () => {
    const runReview = getTool("run_review", "SALES");
    const payload = await runReview.run({ dealId: "123" });
    const parsed = JSON.parse(payload) as { error?: string };

    expect(parsed.error).toMatch(/insufficient permissions/i);
    expect(mockAcquireReviewLock).not.toHaveBeenCalled();
  });

  it("starts async review and returns running status via run_review", async () => {
    const runReview = getTool("run_review", "ADMIN");
    mockAcquireReviewLock.mockResolvedValue("review_1");

    // Background worker mocks (fire-and-forget, but set up to avoid unhandled rejections)
    mockGetById.mockResolvedValue({
      properties: {
        dealname: "PROJ-7777 Test Project",
        dealstage: "20461937",
      },
    });
    mockRunChecks.mockResolvedValue({
      findings: [],
      errorCount: 0,
      warningCount: 0,
      passed: true,
      durationMs: 12,
    });
    mockCompleteReviewRun.mockResolvedValue(undefined);

    const payload = await runReview.run({ dealId: "123" });
    const parsed = JSON.parse(payload) as { status: string; reviewId: string; message: string };

    expect(parsed.status).toBe("running");
    expect(parsed.reviewId).toBe("review_1");
    expect(parsed.message).toContain("get_review_status");

    // Lock was acquired with correct args
    expect(mockAcquireReviewLock).toHaveBeenCalledWith(
      "123",
      "design-review",
      "manual",
      "admin@test.com",
    );
  });

  it("returns already_running status on DuplicateReviewError (attach flow)", async () => {
    const runReview = getTool("run_review", "ADMIN");
    mockAcquireReviewLock.mockRejectedValue(
      new DuplicateReviewError("123", "design-review", "existing-review-xyz")
    );

    const payload = await runReview.run({ dealId: "123" });
    const parsed = JSON.parse(payload) as { status: string; reviewId: string };

    expect(parsed.status).toBe("already_running");
    expect(parsed.reviewId).toBe("existing-review-xyz");
  });

  it("filters deals by stage name using DEAL_STAGE_MAP", async () => {
    const filterByStage = getTool("filter_deals_by_stage");
    mockSearchWithRetry.mockResolvedValue({
      results: [
        { id: "d1", properties: { dealname: "PROJ-1", amount: "1000", pb_location: "Westminster" } },
      ],
    });

    const payload = await filterByStage.run({ stage: "construction" });
    const parsed = JSON.parse(payload) as { stage: string; count: number; deals: Array<{ dealId: string }> };

    expect(mockSearchWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        filterGroups: [
          {
            filters: [
              expect.objectContaining({
                propertyName: "dealstage",
                value: "20440342",
              }),
            ],
          },
        ],
      })
    );
    expect(parsed.stage).toBe("Construction");
    expect(parsed.count).toBe(1);
    expect(parsed.deals[0]?.dealId).toBe("d1");
  });

  it("returns a clear error when filter_deals_by_stage receives an unknown stage", async () => {
    const filterByStage = getTool("filter_deals_by_stage");
    const payload = await filterByStage.run({ stage: "Not A Stage" });
    const parsed = JSON.parse(payload) as { error?: string };

    expect(parsed.error).toMatch(/unknown stage/i);
    expect(mockSearchWithRetry).not.toHaveBeenCalled();
  });

  it("counts active deals by stage", async () => {
    const countDealsByStage = getTool("count_deals_by_stage");
    mockFetchAllProjects.mockResolvedValue([
      { stage: "Construction" },
      { stage: "Construction" },
      { stage: "Design & Engineering" },
    ]);

    const payload = await countDealsByStage.run({});
    const parsed = JSON.parse(payload) as { total: number; counts: Record<string, number> };

    expect(parsed.total).toBe(3);
    expect(parsed.counts.Construction).toBe(2);
    expect(parsed.counts["Design & Engineering"]).toBe(1);
  });
});
