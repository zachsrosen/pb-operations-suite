const mockRequireApiAuth = jest.fn();
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

const mockIsRateLimited = jest.fn();
jest.mock("@/lib/ai", () => ({
  isRateLimited: (...args: unknown[]) => mockIsRateLimited(...args),
}));

jest.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (options: unknown) => options,
}));

const mockRunChecks = jest.fn();
jest.mock("@/lib/checks/runner", () => ({
  runChecks: (...args: unknown[]) => mockRunChecks(...args),
}));
jest.mock("@/lib/checks/design-review", () => ({}));

jest.mock("@/lib/review-lock", () => ({
  acquireReviewLock: jest.fn().mockResolvedValue("mock-review-id"),
  completeReviewRun: jest.fn().mockResolvedValue(undefined),
  failReviewRun: jest.fn().mockResolvedValue(undefined),
  DuplicateReviewError: class DuplicateReviewError extends Error {
    existingReviewId?: string;
    constructor(dealId: string, skill: string, existingReviewId?: string) {
      super(`Review already running for deal ${dealId} (skill: ${skill})`);
      this.existingReviewId = existingReviewId;
    }
  },
}));

const mockGetById = jest.fn();
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
  },
  searchWithRetry: jest.fn(),
  fetchAllProjects: jest.fn(),
}));

const mockProjectReviewCreate = jest.fn();
const mockChatMessageCreate = jest.fn();
const mockTransaction = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    projectReview: {
      create: (...args: unknown[]) => mockProjectReviewCreate(...args),
    },
    chatMessage: {
      create: (...args: unknown[]) => mockChatMessageCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockToolRunner = jest.fn();
jest.mock("@/lib/anthropic", () => ({
  getAnthropicClient: () => ({
    beta: {
      messages: {
        toolRunner: (...args: unknown[]) => mockToolRunner(...args),
      },
    },
  }),
  CLAUDE_MODELS: {
    haiku: "haiku-test-model",
    sonnet: "sonnet-test-model",
  },
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/chat/route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireApiAuth.mockResolvedValue({
      email: "admin@test.com",
      role: "ADMIN",
    });
    mockIsRateLimited.mockReturnValue(false);

    mockGetById.mockResolvedValue({
      properties: {
        dealname: "PROJ-9000 Tool Test",
        dealstage: "20461937",
      },
    });
    mockRunChecks.mockResolvedValue({
      skill: "design-review",
      dealId: "deal_1",
      findings: [{ check: "check-1", severity: "warning", message: "warn" }],
      errorCount: 0,
      warningCount: 1,
      passed: true,
      durationMs: 33,
    });
    mockProjectReviewCreate.mockResolvedValue({ id: "review_1" });
    mockChatMessageCreate.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `msg_${args.data.role}`, ...args.data })
    );
    mockTransaction.mockImplementation(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations)
    );
  });

  it("returns auth error response when requireApiAuth returns NextResponse", async () => {
    mockRequireApiAuth.mockResolvedValue(
      NextResponse.json({ error: "Authentication required" }, { status: 401 })
    );

    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("executes run_review tool via toolRunner and persists ProjectReview + ChatMessages", async () => {
    mockToolRunner.mockImplementation(async (params: { tools: Array<{ name: string; run: (input: Record<string, unknown>) => Promise<string> }> }) => {
      const runReviewTool = params.tools.find((tool) => tool.name === "run_review");
      if (!runReviewTool) throw new Error("run_review tool missing");
      const reviewOutput = await runReviewTool.run({
        dealId: "deal_1",
      });
      return {
        content: [{ type: "text", text: `Tool executed: ${reviewOutput}` }],
      };
    });

    const res = await POST(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Run a design review for this project",
          dealId: "deal_1",
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.model).toBe("sonnet-test-model");
    expect(json.response).toMatch(/tool executed/i);

    expect(mockToolRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "sonnet-test-model",
        max_iterations: 5,
      })
    );
    // run_review now uses acquireReviewLock (fire-and-forget pattern)
    // The tool returns immediately with { status: "running", reviewId }
    // Background worker calls runChecks — not asserted here (async)

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockChatMessageCreate).toHaveBeenCalledTimes(2);
    expect(mockChatMessageCreate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "user",
          dealId: "deal_1",
        }),
      })
    );
    expect(mockChatMessageCreate.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "assistant",
          dealId: "deal_1",
        }),
      })
    );
  });
});
