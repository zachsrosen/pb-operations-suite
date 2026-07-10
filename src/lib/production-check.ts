/**
 * Production-guarantee fix verification workflow ("production check").
 *
 * State machine: DESIGN_REVIEW → PENDING_APPROVAL → APPROVED, with "No"
 * looping back to DESIGN_REVIEW and CANCELLED as a withdrawal state.
 * HubSpot tasks are the notification surface at each step; every transition
 * completes the task it supersedes so nobody keeps a stale open task.
 *
 * See docs/superpowers/specs/2026-07-10-production-check-guarantee-design.md
 */

import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { createTask, markTaskComplete, resolveOwnerIdByEmail } from "@/lib/hubspot-tasks";
import { getRuntimeConfig } from "@/lib/runtime-config-db";
import type { ProductionCheckRequest } from "@/generated/prisma/client";

/** Illegal transition for the row's current status (maps to HTTP 409). */
export class ProductionCheckStateError extends Error {}
/** Bad/missing input, including unknown ids (maps to HTTP 400/404). */
export class ProductionCheckValidationError extends Error {}

const APPROVER_CONFIG_KEY = "production_check_approver_email";
const APPROVER_ENV_KEYS = ["PRODUCTION_CHECK_APPROVER_EMAIL"];
const DEFAULT_DESIGNER_CONFIG_KEY = "production_check_default_designer_email";
const DEFAULT_DESIGNER_ENV_KEYS = ["PRODUCTION_CHECK_DEFAULT_DESIGNER_EMAIL"];

const DASHBOARD_URL = "https://pbtechops.com/dashboards/production-issues";

export type ProductionCheckWarning =
  | "no-designer-task"
  | "no-approval-task"
  | "no-send-plans-task";

export interface ProductionCheckResult {
  request: ProductionCheckRequest;
  warning?: ProductionCheckWarning;
}

function tasksDisabled(): boolean {
  return process.env.PRODUCTION_CHECK_TASKS_DISABLED === "1";
}

/** All HubSpot task writes funnel through here — dev/preview safety valve. */
async function safeCreateTask(
  input: Parameters<typeof createTask>[0],
): Promise<string | null> {
  if (tasksDisabled()) {
    console.log(`[production-check] task writes disabled — skipped create: ${input.subject}`);
    return null;
  }
  const { id } = await createTask(input);
  return id;
}

async function safeCompleteTask(taskId: string | null | undefined): Promise<void> {
  if (!taskId) return;
  if (tasksDisabled()) {
    console.log(`[production-check] task writes disabled — skipped complete: ${taskId}`);
    return;
  }
  try {
    await markTaskComplete(taskId);
  } catch (err) {
    // Never fail a state transition because HubSpot task cleanup failed.
    console.warn(`[production-check] failed to complete task ${taskId}:`, err);
  }
}

async function fetchDeal(dealId: string): Promise<{ dealName: string; designOwnerId: string | null }> {
  const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, ["dealname", "design"]);
  const props = (deal as { properties: Record<string, string | null> }).properties;
  return {
    dealName: props.dealname || `Deal ${dealId}`,
    designOwnerId: props.design?.trim() || null,
  };
}

/**
 * Resolve who should receive designer-facing tasks: the deal's Design Lead
 * (`design` owner property), else the configured default designer email.
 */
async function resolveDesignerOwnerId(designOwnerId: string | null): Promise<string | null> {
  if (designOwnerId) return designOwnerId;
  const fallbackEmail = await getRuntimeConfig(DEFAULT_DESIGNER_CONFIG_KEY, DEFAULT_DESIGNER_ENV_KEYS);
  if (!fallbackEmail?.trim()) return null;
  return resolveOwnerIdByEmail(fallbackEmail.trim());
}

/** The configured service-lead approver email (Jessica), if set. */
export async function getApproverEmail(): Promise<string | null> {
  const email = await getRuntimeConfig(APPROVER_CONFIG_KEY, APPROVER_ENV_KEYS);
  return email?.trim() || null;
}

async function logActivity(opts: {
  dealId: string;
  description: string;
  userEmail: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        type: "PRODUCTION_CHECK",
        description: opts.description,
        userEmail: opts.userEmail,
        entityType: "deal",
        entityId: opts.dealId,
        metadata: opts.metadata as never,
      },
    });
  } catch (err) {
    console.warn("[production-check] activity log write failed:", err);
  }
}

function designerTaskBody(issueSummary: string, extra?: string): string {
  return [
    "A production issue needs a verified fix before it can be approved and sent to Vishtik.",
    "",
    `Issue: ${issueSummary}`,
    ...(extra ? ["", extra] : []),
    "",
    `Submit the proposed solution here: ${DASHBOARD_URL}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export async function createProductionCheck(input: {
  dealId: string;
  issueSummary: string;
  zuperJobUid?: string | null;
  hubspotTicketId?: string | null;
  createdByEmail: string;
}): Promise<ProductionCheckResult> {
  const issueSummary = input.issueSummary?.trim();
  if (!input.dealId?.trim() || !issueSummary) {
    throw new ProductionCheckValidationError("dealId and issueSummary are required");
  }

  const { dealName, designOwnerId } = await fetchDeal(input.dealId);

  let request = await prisma.productionCheckRequest.create({
    data: {
      hubspotDealId: input.dealId,
      dealName,
      zuperJobUid: input.zuperJobUid?.trim() || null,
      hubspotTicketId: input.hubspotTicketId?.trim() || null,
      issueSummary,
      createdByEmail: input.createdByEmail,
    },
  });

  let warning: ProductionCheckWarning | undefined;
  const ownerId = await resolveDesignerOwnerId(designOwnerId);
  if (ownerId) {
    const taskId = await safeCreateTask({
      subject: `Verify production fix solution — ${dealName}`,
      ownerId,
      body: designerTaskBody(issueSummary),
      associate: { dealId: input.dealId },
    });
    if (taskId) {
      request = await prisma.productionCheckRequest.update({
        where: { id: request.id },
        data: { designTaskId: taskId },
      });
    }
  } else {
    warning = "no-designer-task";
  }

  await logActivity({
    dealId: input.dealId,
    description: `Production check started for ${dealName}`,
    userEmail: input.createdByEmail,
    metadata: { requestId: request.id, warning },
  });

  return { request, warning };
}

async function requireRequest(id: string): Promise<ProductionCheckRequest> {
  const row = await prisma.productionCheckRequest.findUnique({ where: { id } });
  if (!row) throw new ProductionCheckValidationError(`Production check ${id} not found`);
  return row;
}

export async function submitSolution(input: {
  id: string;
  proposedSolution: string;
  designerEmail: string;
}): Promise<ProductionCheckResult> {
  const proposedSolution = input.proposedSolution?.trim();
  if (!proposedSolution) {
    throw new ProductionCheckValidationError("proposedSolution is required");
  }

  const row = await requireRequest(input.id);
  if (row.status !== "DESIGN_REVIEW") {
    throw new ProductionCheckStateError(
      `Cannot submit a solution while the request is ${row.status}`,
    );
  }

  await safeCompleteTask(row.designTaskId);

  let warning: ProductionCheckWarning | undefined;
  let approvalTaskId: string | null = null;
  const approverEmail = await getApproverEmail();
  const approverOwnerId = approverEmail ? await resolveOwnerIdByEmail(approverEmail) : null;
  if (approverOwnerId) {
    approvalTaskId = await safeCreateTask({
      subject: `Production fix approval — press Yes or No — ${row.dealName ?? row.hubspotDealId}`,
      ownerId: approverOwnerId,
      body: [
        "Design has verified a fix for this production issue. Approve or send back:",
        "",
        `Issue: ${row.issueSummary}`,
        `Proposed solution: ${proposedSolution}`,
        "",
        `Press Yes or No here: ${DASHBOARD_URL}`,
      ].join("\n"),
      associate: { dealId: row.hubspotDealId },
    });
  }
  if (!approvalTaskId && !tasksDisabled()) warning = "no-approval-task";

  const request = await prisma.productionCheckRequest.update({
    where: { id: row.id },
    data: {
      status: "PENDING_APPROVAL",
      proposedSolution,
      designerEmail: input.designerEmail,
      solutionSubmittedAt: new Date(),
      ...(approvalTaskId ? { approvalTaskId } : {}),
    },
  });

  await logActivity({
    dealId: row.hubspotDealId,
    description: `Production fix solution submitted for ${row.dealName ?? row.hubspotDealId}`,
    userEmail: input.designerEmail,
    metadata: { requestId: row.id, warning },
  });

  return { request, warning };
}

export async function decide(input: {
  id: string;
  decision: "yes" | "no";
  reason?: string;
  decidedByEmail: string;
}): Promise<ProductionCheckResult> {
  const row = await requireRequest(input.id);
  if (row.status !== "PENDING_APPROVAL") {
    throw new ProductionCheckStateError(`Cannot decide a request that is ${row.status}`);
  }

  const dealLabel = row.dealName ?? row.hubspotDealId;
  await safeCompleteTask(row.approvalTaskId);

  if (input.decision === "yes") {
    let warning: ProductionCheckWarning | undefined;
    const { designOwnerId } = await fetchDeal(row.hubspotDealId);
    const ownerId = await resolveDesignerOwnerId(designOwnerId);
    let sendPlansTaskId: string | null = null;
    if (ownerId) {
      sendPlansTaskId = await safeCreateTask({
        subject: `Send Plans — production fix — ${dealLabel}`,
        ownerId,
        body: [
          "The production fix was approved. Send the plans to Vishtik.",
          "",
          `Issue: ${row.issueSummary}`,
          `Approved solution: ${row.proposedSolution ?? "(see request)"}`,
        ].join("\n"),
        associate: { dealId: row.hubspotDealId },
      });
    }
    if (!sendPlansTaskId && !tasksDisabled()) warning = "no-send-plans-task";

    const request = await prisma.productionCheckRequest.update({
      where: { id: row.id },
      data: {
        status: "APPROVED",
        decidedByEmail: input.decidedByEmail,
        decidedAt: new Date(),
        ...(sendPlansTaskId ? { sendPlansTaskId } : {}),
      },
    });

    await logActivity({
      dealId: row.hubspotDealId,
      description: `Production fix APPROVED for ${dealLabel}`,
      userEmail: input.decidedByEmail,
      metadata: { requestId: row.id, warning },
    });

    return { request, warning };
  }

  // decision === "no" — back to design with a required reason.
  const reason = input.reason?.trim();
  if (!reason) {
    throw new ProductionCheckValidationError("A reason is required when sending back to design");
  }

  const { designOwnerId } = await fetchDeal(row.hubspotDealId);
  const ownerId = await resolveDesignerOwnerId(designOwnerId);
  let designTaskId: string | null = null;
  let warning: ProductionCheckWarning | undefined;
  if (ownerId) {
    designTaskId = await safeCreateTask({
      subject: `Rework production fix solution — ${dealLabel}`,
      ownerId,
      body: designerTaskBody(row.issueSummary, `Sent back by ${input.decidedByEmail}: ${reason}`),
      associate: { dealId: row.hubspotDealId },
    });
  }
  if (!designTaskId && !tasksDisabled()) warning = "no-designer-task";

  const request = await prisma.productionCheckRequest.update({
    where: { id: row.id },
    data: {
      status: "DESIGN_REVIEW",
      designCycles: row.designCycles + 1,
      rejectionReason: reason,
      decidedByEmail: input.decidedByEmail,
      decidedAt: new Date(),
      ...(designTaskId ? { designTaskId } : {}),
    },
  });

  await logActivity({
    dealId: row.hubspotDealId,
    description: `Production fix sent back to design for ${dealLabel}: ${reason}`,
    userEmail: input.decidedByEmail,
    metadata: { requestId: row.id, warning },
  });

  return { request, warning };
}

export async function cancelProductionCheck(input: {
  id: string;
  cancelledByEmail: string;
}): Promise<ProductionCheckResult> {
  const row = await requireRequest(input.id);
  if (row.status !== "DESIGN_REVIEW" && row.status !== "PENDING_APPROVAL") {
    throw new ProductionCheckStateError(`Cannot cancel a request that is ${row.status}`);
  }

  await safeCompleteTask(row.status === "DESIGN_REVIEW" ? row.designTaskId : row.approvalTaskId);

  const request = await prisma.productionCheckRequest.update({
    where: { id: row.id },
    data: { status: "CANCELLED" },
  });

  await logActivity({
    dealId: row.hubspotDealId,
    description: `Production check cancelled for ${row.dealName ?? row.hubspotDealId}`,
    userEmail: input.cancelledByEmail,
    metadata: { requestId: row.id },
  });

  return { request };
}

export async function listProductionChecks(): Promise<ProductionCheckRequest[]> {
  return prisma.productionCheckRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
