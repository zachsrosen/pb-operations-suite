import { logActivity, prisma } from "@/lib/db";
import { sendBugReportEmail } from "@/lib/email";

interface CreateAutomatedBugReportInput {
  title: string;
  description: string;
  pageUrl?: string;
  reporterEmail: string;
  reporterName?: string;
  entityId?: string;
  entityName?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  dedupeWindowHours?: number;
}

export async function createAutomatedBugReport(
  input: CreateAutomatedBugReportInput
): Promise<{ created: boolean; reportId?: string; deduped?: boolean; emailSent?: boolean }> {
  if (!prisma) {
    return { created: false };
  }

  const title = input.title.trim().slice(0, 200);
  const description = input.description.trim().slice(0, 5000);
  const pageUrl = input.pageUrl?.trim() || null;
  const reporterEmail = input.reporterEmail.trim().toLowerCase();
  const reporterName = input.reporterName?.trim() || null;
  const dedupeWindowHours = Number.isFinite(input.dedupeWindowHours)
    ? Math.max(1, Number(input.dedupeWindowHours))
    : 6;
  const windowStart = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000);

  const existing = await prisma.bugReport.findFirst({
    where: {
      title,
      reporterEmail,
      pageUrl,
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, emailSent: true },
  });

  if (existing) {
    return {
      created: false,
      deduped: true,
      reportId: existing.id,
      emailSent: existing.emailSent,
    };
  }

  const report = await prisma.bugReport.create({
    data: {
      type: "BUG",
      title,
      description,
      pageUrl,
      reporterEmail,
      reporterName,
    },
  });

  let emailSent = false;
  try {
    const emailResult = await sendBugReportEmail({
      reportId: report.id,
      type: "BUG",
      title: report.title,
      description: report.description,
      pageUrl: report.pageUrl || undefined,
      reporterName: report.reporterName || undefined,
      reporterEmail: report.reporterEmail,
    });
    emailSent = emailResult.success;

    await prisma.bugReport.update({
      where: { id: report.id },
      data: { emailSent },
    });
  } catch (emailErr) {
    console.warn("Failed to send automated bug report email:", emailErr);
  }

  await logActivity({
    type: "BUG_REPORTED",
    description: `Automated bug report submitted: ${title}`,
    userEmail: reporterEmail,
    userName: reporterName || undefined,
    entityType: "bug_report",
    entityId: report.id,
    entityName: title,
    metadata: {
      automated: true,
      emailSent,
      ...(input.metadata || {}),
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { created: true, reportId: report.id, emailSent };
}
