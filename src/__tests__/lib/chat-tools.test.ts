const mockBetaZodTool = jest.fn((options) => options);
jest.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (options: unknown) => mockBetaZodTool(options),
}));

const mockRunChecks = jest.fn();
jest.mock("@/lib/checks/runner", () => ({
  runChecks: (...args: unknown[]) => mockRunChecks(...args),
}));

jest.mock("@/lib/checks/design-review", () => ({}));
jest.mock("@/lib/checks/engineering-review", () => ({}));
jest.mock("@/lib/checks/sales-advisor", () => ({}));

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

const mockProjectReviewCreate = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    projectReview: {
      create: (...args: unknown[]) => mockProjectReviewCreate(...args),
    },
  },
}));

import { createChatTools } from "@/lib/chat-tools";

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

  it("registers all six tools", () => {
    const tools = createChatTools({ email: "admin@test.com", role: "ADMIN" }) as unknown as ToolLike[];
    expect(tools.map((t) => t.name)).toEqual([
      "get_deal",
      "get_review_results",
      "search_deals",
      "run_review",
      "filter_deals_by_stage",
      "count_deals_by_stage",
    ]);
  });

  it("blocks run_review when caller role is not allowed for the requested skill", async () => {
    const runReview = getTool("run_review", "SALES");
    const payload = await runReview.run({ dealId: "123", skill: "design-review" });
    const parsed = JSON.parse(payload) as { error?: string };

    expect(parsed.error).toMatch(/insufficient permissions/i);
    expect(mockRunChecks).not.toHaveBeenCalled();
    expect(mockProjectReviewCreate).not.toHaveBeenCalled();
  });

  it("runs and persists review results via run_review", async () => {
    const runReview = getTool("run_review", "ADMIN");
    mockGetById.mockResolvedValue({
      properties: {
        dealname: "PROJ-7777 Test Project",
        dealstage: "20461937",
      },
    });
    mockRunChecks.mockResolvedValue({
      skill: "design-review",
      dealId: "123",
      findings: [{ check: "c1", severity: "warning", message: "warn" }],
      errorCount: 0,
      warningCount: 1,
      passed: true,
      durationMs: 12,
    });
    mockProjectReviewCreate.mockResolvedValue({ id: "review_1" });

    const payload = await runReview.run({ dealId: "123", skill: "design-review" });
    const parsed = JSON.parse(payload) as { id: string; persisted: boolean };

    expect(mockRunChecks).toHaveBeenCalledWith(
      "design-review",
      expect.objectContaining({ dealId: "123" })
    );
    expect(mockProjectReviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dealId: "123",
          projectId: "PROJ-7777",
          trigger: "manual",
          triggeredBy: "admin@test.com",
        }),
      })
    );
    expect(parsed.id).toBe("review_1");
    expect(parsed.persisted).toBe(true);
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
