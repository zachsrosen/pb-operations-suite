/**
 * Production-check state machine tests.
 * See docs/superpowers/specs/2026-07-10-production-check-guarantee-design.md
 */

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockFindUnique = jest.fn();
const mockActivityCreate = jest.fn(async () => ({}));

jest.mock("@/lib/db", () => ({
  prisma: {
    productionCheckRequest: {
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    activityLog: { create: (...args: unknown[]) => mockActivityCreate(...args) },
  },
}));

const mockGetById = jest.fn();
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: { deals: { basicApi: { getById: (...args: unknown[]) => mockGetById(...args) } } },
  },
}));

const mockCreateTask = jest.fn(async () => ({ id: "task-new" }));
const mockMarkTaskComplete = jest.fn(async () => undefined);
const mockResolveOwnerIdByEmail = jest.fn();
jest.mock("@/lib/hubspot-tasks", () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  markTaskComplete: (...args: unknown[]) => mockMarkTaskComplete(...args),
  resolveOwnerIdByEmail: (...args: unknown[]) => mockResolveOwnerIdByEmail(...args),
}));

const mockGetRuntimeConfig = jest.fn();
jest.mock("@/lib/runtime-config-db", () => ({
  getRuntimeConfig: (...args: unknown[]) => mockGetRuntimeConfig(...args),
}));

import {
  createProductionCheck,
  submitSolution,
  decide,
  cancelProductionCheck,
  ProductionCheckStateError,
  ProductionCheckValidationError,
} from "@/lib/production-check";

type Row = Record<string, unknown>;

function baseRow(overrides: Row = {}): Row {
  return {
    id: "pc-1",
    hubspotDealId: "111",
    dealName: "PROJ-1000 | Smith",
    zuperJobUid: null,
    hubspotTicketId: null,
    status: "DESIGN_REVIEW",
    issueSummary: "System underproducing 20% vs proposal",
    proposedSolution: null,
    designerEmail: null,
    solutionSubmittedAt: null,
    decidedByEmail: null,
    decidedAt: null,
    rejectionReason: null,
    designCycles: 1,
    estimatedCostCents: null,
    costBreakdown: null,
    designTaskId: "task-design",
    approvalTaskId: null,
    sendPlansTaskId: null,
    createdByEmail: "jessica@x",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PRODUCTION_CHECK_TASKS_DISABLED;
  mockCreate.mockImplementation(async ({ data }: { data: Row }) => ({ ...baseRow(), designTaskId: null, ...data }));
  mockUpdate.mockImplementation(async ({ data }: { data: Row }) => ({ ...baseRow(), ...data }));
  mockGetById.mockResolvedValue({
    properties: { dealname: "PROJ-1000 | Smith", design: "owner-77" },
  });
  mockGetRuntimeConfig.mockResolvedValue(undefined);
  mockResolveOwnerIdByEmail.mockResolvedValue(null);
});

describe("createProductionCheck", () => {
  const input = {
    dealId: "111",
    issueSummary: "System underproducing 20% vs proposal",
    createdByEmail: "jessica@x",
  };

  it("creates a DESIGN_REVIEW row with dealName snapshot and a designer task to the deal's design lead", async () => {
    mockCreateTask.mockResolvedValueOnce({ id: "task-design" });
    const { request, warning } = await createProductionCheck(input);

    expect(warning).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hubspotDealId: "111",
          dealName: "PROJ-1000 | Smith",
          issueSummary: input.issueSummary,
          createdByEmail: "jessica@x",
        }),
      }),
    );
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-77",
        subject: "Verify production fix solution — PROJ-1000 | Smith",
        associate: { dealId: "111" },
        body: expect.stringContaining("/dashboards/production-issues"),
      }),
    );
    // designTaskId persisted
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ designTaskId: "task-design" }) }),
    );
    expect(request).toBeTruthy();
  });

  it("falls back to the configured default designer email when the deal has no design lead", async () => {
    mockGetById.mockResolvedValueOnce({ properties: { dealname: "PROJ-1000 | Smith", design: "" } });
    mockGetRuntimeConfig.mockImplementation(async (key: string) =>
      key === "production_check_default_designer_email" ? "designer@x" : undefined,
    );
    mockResolveOwnerIdByEmail.mockResolvedValueOnce("owner-fallback");

    const { warning } = await createProductionCheck(input);

    expect(warning).toBeUndefined();
    expect(mockResolveOwnerIdByEmail).toHaveBeenCalledWith("designer@x");
    expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner-fallback" }));
  });

  it("returns a warning and creates no task when neither design lead nor fallback resolves", async () => {
    mockGetById.mockResolvedValueOnce({ properties: { dealname: "PROJ-1000 | Smith", design: "" } });

    const { warning } = await createProductionCheck(input);

    expect(warning).toBe("no-designer-task");
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("logs a PRODUCTION_CHECK activity", async () => {
    await createProductionCheck(input);
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "PRODUCTION_CHECK", entityType: "deal", entityId: "111" }),
      }),
    );
  });

  it("skips all task writes when PRODUCTION_CHECK_TASKS_DISABLED=1", async () => {
    process.env.PRODUCTION_CHECK_TASKS_DISABLED = "1";
    const { request } = await createProductionCheck(input);
    expect(request).toBeTruthy();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });
});

describe("submitSolution", () => {
  const input = { id: "pc-1", proposedSolution: "Replace failed optimizer, re-string array", designerEmail: "designer@x" };

  it("moves DESIGN_REVIEW → PENDING_APPROVAL, completes the design task, and creates the approval task", async () => {
    mockFindUnique.mockResolvedValue(baseRow());
    mockGetRuntimeConfig.mockImplementation(async (key: string) =>
      key === "production_check_approver_email" ? "jessica@x" : undefined,
    );
    mockResolveOwnerIdByEmail.mockResolvedValueOnce("owner-jessica");
    mockCreateTask.mockResolvedValueOnce({ id: "task-approval" });

    const { warning } = await submitSolution(input);

    expect(warning).toBeUndefined();
    expect(mockMarkTaskComplete).toHaveBeenCalledWith("task-design");
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-jessica",
        subject: "Production fix approval — press Yes or No — PROJ-1000 | Smith",
        associate: { dealId: "111" },
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_APPROVAL",
          proposedSolution: input.proposedSolution,
          designerEmail: "designer@x",
          solutionSubmittedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("throws ProductionCheckStateError when the row is not in DESIGN_REVIEW", async () => {
    mockFindUnique.mockResolvedValue(baseRow({ status: "PENDING_APPROVAL" }));
    await expect(submitSolution(input)).rejects.toBeInstanceOf(ProductionCheckStateError);
  });

  it("still transitions with a warning when no approver is configured", async () => {
    mockFindUnique.mockResolvedValue(baseRow());
    const { warning } = await submitSolution(input);
    expect(warning).toBe("no-approval-task");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_APPROVAL" }) }),
    );
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("still transitions with a warning when the approver email resolves to no HubSpot owner", async () => {
    mockFindUnique.mockResolvedValue(baseRow());
    mockGetRuntimeConfig.mockImplementation(async (key: string) =>
      key === "production_check_approver_email" ? "jessica@x" : undefined,
    );
    mockResolveOwnerIdByEmail.mockResolvedValueOnce(null);

    const { warning } = await submitSolution(input);
    expect(warning).toBe("no-approval-task");
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("does not fail the transition when completing the old task throws", async () => {
    mockFindUnique.mockResolvedValue(baseRow());
    mockMarkTaskComplete.mockRejectedValueOnce(new Error("hubspot down"));
    await expect(submitSolution(input)).resolves.toBeTruthy();
  });
});

describe("decide", () => {
  const pending = () =>
    baseRow({ status: "PENDING_APPROVAL", approvalTaskId: "task-approval", proposedSolution: "fix" });

  it("yes → APPROVED, completes approval task, creates the Send Plans task to the design lead", async () => {
    mockFindUnique.mockResolvedValue(pending());
    mockCreateTask.mockResolvedValueOnce({ id: "task-send-plans" });

    const { warning } = await decide({ id: "pc-1", decision: "yes", decidedByEmail: "jessica@x" });

    expect(warning).toBeUndefined();
    expect(mockMarkTaskComplete).toHaveBeenCalledWith("task-approval");
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-77",
        subject: "Send Plans — production fix — PROJ-1000 | Smith",
        associate: { dealId: "111" },
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "APPROVED",
          decidedByEmail: "jessica@x",
          decidedAt: expect.any(Date),
          sendPlansTaskId: "task-send-plans",
        }),
      }),
    );
  });

  it("yes with no resolvable design lead → APPROVED with a warning, no task", async () => {
    mockFindUnique.mockResolvedValue(pending());
    mockGetById.mockResolvedValueOnce({ properties: { dealname: "PROJ-1000 | Smith", design: "" } });

    const { warning } = await decide({ id: "pc-1", decision: "yes", decidedByEmail: "jessica@x" });

    expect(warning).toBe("no-send-plans-task");
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }),
    );
  });

  it("no → back to DESIGN_REVIEW with incremented cycle, reason stored, new designer task with the reason", async () => {
    mockFindUnique.mockResolvedValue(pending());
    mockCreateTask.mockResolvedValueOnce({ id: "task-design-2" });

    await decide({ id: "pc-1", decision: "no", reason: "Wrong panel count", decidedByEmail: "jessica@x" });

    expect(mockMarkTaskComplete).toHaveBeenCalledWith("task-approval");
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-77",
        subject: "Rework production fix solution — PROJ-1000 | Smith",
        body: expect.stringContaining("Wrong panel count"),
      }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DESIGN_REVIEW",
          designCycles: 2,
          rejectionReason: "Wrong panel count",
          designTaskId: "task-design-2",
        }),
      }),
    );
  });

  it("no without a reason → ProductionCheckValidationError", async () => {
    mockFindUnique.mockResolvedValue(pending());
    await expect(
      decide({ id: "pc-1", decision: "no", reason: "   ", decidedByEmail: "jessica@x" }),
    ).rejects.toBeInstanceOf(ProductionCheckValidationError);
  });

  it("deciding a non-pending row → ProductionCheckStateError (double-submit guard)", async () => {
    mockFindUnique.mockResolvedValue(baseRow({ status: "APPROVED" }));
    await expect(
      decide({ id: "pc-1", decision: "yes", decidedByEmail: "jessica@x" }),
    ).rejects.toBeInstanceOf(ProductionCheckStateError);
  });

  it("unknown id → ProductionCheckValidationError", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      decide({ id: "nope", decision: "yes", decidedByEmail: "jessica@x" }),
    ).rejects.toBeInstanceOf(ProductionCheckValidationError);
  });
});

describe("cancelProductionCheck", () => {
  it("cancels from DESIGN_REVIEW and completes the open design task", async () => {
    mockFindUnique.mockResolvedValue(baseRow());
    await cancelProductionCheck({ id: "pc-1", cancelledByEmail: "jessica@x" });
    expect(mockMarkTaskComplete).toHaveBeenCalledWith("task-design");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  it("cancels from PENDING_APPROVAL and completes the open approval task", async () => {
    mockFindUnique.mockResolvedValue(baseRow({ status: "PENDING_APPROVAL", approvalTaskId: "task-approval" }));
    await cancelProductionCheck({ id: "pc-1", cancelledByEmail: "jessica@x" });
    expect(mockMarkTaskComplete).toHaveBeenCalledWith("task-approval");
  });

  it("cannot cancel an APPROVED request", async () => {
    mockFindUnique.mockResolvedValue(baseRow({ status: "APPROVED" }));
    await expect(cancelProductionCheck({ id: "pc-1", cancelledByEmail: "j@x" })).rejects.toBeInstanceOf(
      ProductionCheckStateError,
    );
  });
});
