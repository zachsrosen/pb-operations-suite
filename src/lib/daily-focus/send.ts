// src/lib/daily-focus/send.ts
import { sendEmailMessage } from "@/lib/email";
import { prisma } from "@/lib/db";
import {
  PI_LEADS,
  DESIGN_LEADS,
  PI_QUERY_DEFS,
  DESIGN_QUERY_DEFS,
  MANAGER_EMAIL,
  type QueryDef,
} from "./config";
import { queryAllSections, type SectionResult } from "./queries";
import { buildStageDisplayMap } from "./format";
import { buildIndividualEmail, buildRollupEmail } from "./html";

// ── Types ──────────────────────────────────────────────────────────────

export interface DailyFocusResult {
  type: "pi" | "design";
  emailsSent: number;
  rollupSent: boolean;
  totalItems: number;
  errors: string[];
  leadSummaries: { name: string; total: number }[];
  skippedReason?: string;
}

interface SendOptions {
  dryRun: boolean;
}

// ── Idempotency ────────────────────────────────────────────────────────

function getTodayKey(type: "pi" | "design"): string {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  return `daily-focus:${type}:${date}`;
}

async function checkAndClaimIdempotencyKey(
  type: "pi" | "design",
  dryRun: boolean
): Promise<{ alreadySent: boolean }> {
  if (dryRun) return { alreadySent: false };
  if (!prisma) return { alreadySent: false };

  const key = getTodayKey(type);
  const scope = "daily-focus";

  try {
    // Create-first pattern: attempt insert. If the key already exists,
    // the unique constraint throws and we check the existing record.
    await prisma.idempotencyKey.create({
      data: {
        key,
        scope,
        status: "processing",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    return { alreadySent: false };
  } catch {
    // Key already exists — atomic reclaim for "failed" keys only.
    // updateMany with status filter ensures only one concurrent caller wins.
    try {
      const reclaimed = await prisma.idempotencyKey.updateMany({
        where: { key, scope, status: "failed" },
        data: { status: "processing" },
      });
      if (reclaimed.count > 0) {
        return { alreadySent: false }; // we won the reclaim
      }
      // Key exists but is "processing" or "completed" — another invocation owns it
      return { alreadySent: true };
    } catch (innerErr) {
      console.error(`[daily-focus] Idempotency check failed, proceeding: ${innerErr}`);
      return { alreadySent: false };
    }
  }
}

async function markIdempotencyStatus(type: "pi" | "design", status: "completed" | "failed"): Promise<void> {
  if (!prisma) return;
  try {
    const key = getTodayKey(type);
    await prisma.idempotencyKey.update({
      where: { key_scope: { key, scope: "daily-focus" } },
      data: { status },
    });
  } catch {
    // Best-effort
  }
}

// ── Date formatting ────────────────────────────────────────────────────

function formatDateForSubject(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Denver",
  });
}

// ── Individual email send ──────────────────────────────────────────────

async function sendIndividualEmail(opts: {
  to: string;
  firstName: string;
  sections: SectionResult[];
  stageMap: Record<string, string>;
  emailType: "pi" | "design";
  dryRun: boolean;
}): Promise<{ sent: boolean; error?: string }> {
  const grandTotal = opts.sections.reduce((s, sec) => s + sec.total, 0);
  if (grandTotal === 0) return { sent: false };

  const html = buildIndividualEmail(
    opts.firstName,
    opts.sections,
    opts.stageMap,
    opts.emailType
  );
  if (!html) return { sent: false };

  const typeLabel = opts.emailType === "pi" ? "P&I" : "Design";
  const dateStr = formatDateForSubject();
  const subjectPrefix = opts.dryRun ? "[DRY RUN] " : "";
  const subject = `${subjectPrefix}${typeLabel} Daily Focus \u2014 ${dateStr}`;

  let finalHtml = html;
  if (opts.dryRun) {
    const banner = `<div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:4px;padding:8px 12px;margin-bottom:12px;font-size:12px;"><strong>DRY RUN</strong> \u2014 This would have been sent to: <strong>${opts.to}</strong></div>`;
    finalHtml = html.replace(
      "Here's what's ready for action today:</p>",
      `Here's what's ready for action today:</p>\n${banner}`
    );
  }

  const actualTo = opts.dryRun ? MANAGER_EMAIL : opts.to;
  const bcc = opts.dryRun ? [] : [MANAGER_EMAIL];

  const result = await sendEmailMessage({
    to: actualTo,
    bcc,
    subject,
    html: finalHtml,
    text: `${typeLabel} Daily Focus \u2014 ${dateStr}. ${grandTotal} action items. View in email client for details.`,
    debugFallbackTitle: subject,
    debugFallbackBody: `${grandTotal} action items for ${opts.firstName}`,
  });

  return { sent: result.success, error: result.error };
}

// ── Rollup send ────────────────────────────────────────────────────────

async function sendRollupEmail(opts: {
  leads: { name: string; sections: SectionResult[]; grandTotal: number }[];
  defs: QueryDef[];
  stageMap: Record<string, string>;
  emailType: "pi" | "design";
  dryRun: boolean;
  /** Top-level lead errors (from catch path where sections: []) */
  leadErrors?: string[];
}): Promise<{ sent: boolean; error?: string }> {
  const typeLabel = opts.emailType === "pi" ? "P&I" : "Design";
  const dateStr = formatDateForSubject();
  const subjectPrefix = opts.dryRun ? "[DRY RUN] " : "";
  const subject = `${subjectPrefix}${typeLabel} Daily Rollup \u2014 ${dateStr}`;

  const teamTotal = opts.leads.reduce((s, l) => s + l.grandTotal, 0);

  // All-clear requires: every lead produced sections AND no section errors.
  // Empty sections array means the lead's query blew up entirely (catch path).
  const allQueriesSucceeded = opts.leads.every(
    (l) => l.sections.length > 0 && l.sections.every((s) => !s.error)
  );

  let html: string;
  if (teamTotal === 0 && allQueriesSucceeded) {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,sans-serif;padding:20px;">
      <p>All clear \u2014 no pending ${typeLabel} actions today.</p>
    </body></html>`;
  } else {
    html = buildRollupEmail(
      opts.leads,
      opts.defs.map((d) => ({ key: d.key, label: d.label })),
      opts.stageMap,
      opts.emailType
    );

    // Collect both section-level query failures and whole-lead failures
    const allFailures = [
      ...(opts.leadErrors ?? []),
      ...opts.leads.flatMap((l) =>
        l.sections.filter((s) => s.error).map((s) => `${l.name} / ${s.label}: ${s.error}`)
      ),
    ];
    if (allFailures.length > 0) {
      const errorBlock = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;padding:8px 12px;margin-top:16px;font-size:11px;color:#991b1b;"><strong>Query errors:</strong><ul style="margin:4px 0 0;">${allFailures.map((e) => `<li>${e}</li>`).join("")}</ul></div>`;
      html = html.replace("</div>\n</body>", `${errorBlock}</div>\n</body>`);
    }
  }

  const result = await sendEmailMessage({
    to: MANAGER_EMAIL,
    subject,
    html,
    text: `${typeLabel} Daily Rollup \u2014 ${dateStr}. ${teamTotal} total action items across team.`,
    debugFallbackTitle: subject,
    debugFallbackBody: `${teamTotal} total items`,
  });

  return { sent: result.success, error: result.error };
}

// ── Main orchestrators ─────────────────────────────────────────────────

export async function runPIDailyFocus(options: SendOptions): Promise<DailyFocusResult> {
  const { alreadySent } = await checkAndClaimIdempotencyKey("pi", options.dryRun);
  if (alreadySent) {
    return {
      type: "pi",
      emailsSent: 0,
      rollupSent: false,
      totalItems: 0,
      errors: [],
      leadSummaries: [],
      skippedReason: "already sent today",
    };
  }

  const errors: string[] = [];
  const stageMap = await buildStageDisplayMap();
  let emailsSent = 0;

  const leadSummaries: { name: string; sections: SectionResult[]; grandTotal: number }[] = [];

  for (const lead of PI_LEADS) {
    try {
      const sections = await queryAllSections(PI_QUERY_DEFS, lead.hubspotOwnerId, lead.roles);
      const grandTotal = sections.reduce((s, sec) => s + sec.total, 0);
      leadSummaries.push({ name: lead.name, sections, grandTotal });

      const result = await sendIndividualEmail({
        to: lead.email,
        firstName: lead.firstName,
        sections,
        stageMap,
        emailType: "pi",
        dryRun: options.dryRun,
      });
      if (result.sent) emailsSent++;
      if (result.error) errors.push(`${lead.name}: ${result.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${lead.name}: ${msg}`);
      leadSummaries.push({ name: lead.name, sections: [], grandTotal: 0 });
    }
  }

  const rollup = await sendRollupEmail({
    leads: leadSummaries,
    defs: PI_QUERY_DEFS,
    stageMap,
    emailType: "pi",
    dryRun: options.dryRun,
    leadErrors: errors.length > 0 ? [...errors] : undefined,
  });
  if (rollup.error) errors.push(`Rollup: ${rollup.error}`);

  if (!options.dryRun) {
    await markIdempotencyStatus("pi", errors.length === 0 ? "completed" : "failed");
  }

  return {
    type: "pi",
    emailsSent,
    rollupSent: rollup.sent,
    totalItems: leadSummaries.reduce((s, l) => s + l.grandTotal, 0),
    errors,
    leadSummaries: leadSummaries.map((l) => ({ name: l.name, total: l.grandTotal })),
  };
}

export async function runDesignDailyFocus(options: SendOptions): Promise<DailyFocusResult> {
  const { alreadySent } = await checkAndClaimIdempotencyKey("design", options.dryRun);
  if (alreadySent) {
    return {
      type: "design",
      emailsSent: 0,
      rollupSent: false,
      totalItems: 0,
      errors: [],
      leadSummaries: [],
      skippedReason: "already sent today",
    };
  }

  const errors: string[] = [];
  const stageMap = await buildStageDisplayMap();
  let emailsSent = 0;

  const leadSummaries: { name: string; sections: SectionResult[]; grandTotal: number }[] = [];

  for (const lead of DESIGN_LEADS) {
    try {
      const sections = await queryAllSections(DESIGN_QUERY_DEFS, lead.hubspotOwnerId);
      const grandTotal = sections.reduce((s, sec) => s + sec.total, 0);
      leadSummaries.push({ name: lead.name, sections, grandTotal });

      const result = await sendIndividualEmail({
        to: lead.email,
        firstName: lead.firstName,
        sections,
        stageMap,
        emailType: "design",
        dryRun: options.dryRun,
      });
      if (result.sent) emailsSent++;
      if (result.error) errors.push(`${lead.name}: ${result.error}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${lead.name}: ${msg}`);
      leadSummaries.push({ name: lead.name, sections: [], grandTotal: 0 });
    }
  }

  const rollup = await sendRollupEmail({
    leads: leadSummaries,
    defs: DESIGN_QUERY_DEFS,
    stageMap,
    emailType: "design",
    dryRun: options.dryRun,
    leadErrors: errors.length > 0 ? [...errors] : undefined,
  });
  if (rollup.error) errors.push(`Rollup: ${rollup.error}`);

  if (!options.dryRun) {
    await markIdempotencyStatus("design", errors.length === 0 ? "completed" : "failed");
  }

  return {
    type: "design",
    emailsSent,
    rollupSent: rollup.sent,
    totalItems: leadSummaries.reduce((s, l) => s + l.grandTotal, 0),
    errors,
    leadSummaries: leadSummaries.map((l) => ({ name: l.name, total: l.grandTotal })),
  };
}
