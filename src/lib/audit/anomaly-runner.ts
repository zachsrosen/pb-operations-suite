/**
 * Anomaly runner -- evaluates all rules and persists events.
 */

import { RISK_LEVELS_BY_SCORE } from "./detect";
import {
  checkOffHours,
  checkRapidActions,
  checkUnknownClientOnProd,
  checkNewDevice,
  checkNewIP,
  checkSensitiveFromNewContext,
  checkImpossibleTravel,
  type AnomalyRuleResult,
} from "./anomaly-rules";
import { sendImmediateAlert } from "./alerts";

// Minimal session shape (no Prisma import)
export interface AuditSessionLike {
  id: string;
  userId: string | null;
  userEmail: string | null;
  clientType: string;
  environment: string;
  ipAddress: string;
  deviceFingerprint: string | null;
  riskScore: number;
  anomalyReasons: string[];
}

export interface AnomalyContext {
  session: AuditSessionLike;
  activityRiskScore: number;
  mutatingActionCountLast5Min: number;
  fingerprintKnown: boolean;
  ipKnown: boolean;
}

/**
 * Run all sync anomaly rules for a session.
 * Persists AuditAnomalyEvent records and escalates session risk if needed.
 */
export async function runAnomalyChecks(
  ctx: AnomalyContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<AnomalyRuleResult[]> {
  if (!prisma) return [];

  const results: AnomalyRuleResult[] = [
    checkOffHours(new Date()),
    checkRapidActions(ctx.mutatingActionCountLast5Min),
    checkUnknownClientOnProd(ctx.session.clientType, ctx.session.environment),
    checkNewDevice(ctx.fingerprintKnown, ctx.session.deviceFingerprint),
    checkNewIP(ctx.ipKnown, ctx.session.ipAddress, ctx.session.environment),
    checkImpossibleTravel(),
  ];

  const triggered = results.filter((r) => r.triggered);

  // sensitive_from_new_context depends on other results
  const hasNewDevice = triggered.some((r) => r.rule === "new_device");
  const hasNewIP = triggered.some((r) => r.rule === "new_ip");
  const sensitiveCheck = checkSensitiveFromNewContext(
    ctx.activityRiskScore,
    hasNewDevice,
    hasNewIP
  );
  if (sensitiveCheck.triggered) {
    triggered.push(sensitiveCheck);
  }

  // Persist anomaly events (if any rules triggered)
  if (triggered.length > 0) {
    await prisma.auditAnomalyEvent.createMany({
      data: triggered.map((r: AnomalyRuleResult) => ({
        sessionId: ctx.session.id,
        rule: r.rule,
        riskScore: r.riskScore,
        evidence: r.evidence,
      })),
    });
  }

  // Escalate session risk (risk only goes UP, never down).
  // Include both anomaly rule scores AND the current activity's intrinsic risk,
  // so a CRITICAL action (e.g. USER_DELETED) escalates even without anomaly triggers.
  const maxTriggeredScore = Math.max(
    ctx.activityRiskScore,
    ...triggered.map((r: AnomalyRuleResult) => r.riskScore),
    0 // fallback when triggered is empty
  );
  const newRiskScore = Math.max(ctx.session.riskScore, maxTriggeredScore);

  if (newRiskScore > ctx.session.riskScore) {
    const newReasons = [
      ...ctx.session.anomalyReasons,
      ...triggered.map((r: AnomalyRuleResult) => r.rule),
    ];
    await prisma.auditSession.update({
      where: { id: ctx.session.id },
      data: {
        riskScore: newRiskScore,
        riskLevel: RISK_LEVELS_BY_SCORE[newRiskScore] || "LOW",
        anomalyReasons: [...new Set(newReasons)],
      },
    });
  }

  // Check for alert even if no NEW escalation (session may already be HIGH/CRITICAL)
  if (newRiskScore >= 3 || ctx.session.riskScore >= 3) {
    const updatedSession = await prisma.auditSession.findUnique({
      where: { id: ctx.session.id },
    });
    if (updatedSession) {
      sendImmediateAlert(updatedSession, prisma).catch((e: unknown) =>
        console.error("Alert email failed:", e)
      );
    }
  }

  return triggered;
}
