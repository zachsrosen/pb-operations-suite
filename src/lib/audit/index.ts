// Barrel export for audit module
export {
  detectEnvironment,
  detectClientType,
  isPrivateIP,
  maskIP,
  RISK_SCORES,
  RISK_LEVELS_BY_SCORE,
  ACTIVITY_RISK_MAP,
  getActivityRiskLevel,
} from "./detect";

export {
  getOrCreateAuditSession,
  resolveSessionMatch,
  computeConfidence,
  hashCode,
  runSessionAnomalyChecks,
  SESSION_INACTIVITY_TIMEOUT_MS,
} from "./session";

export type { GetOrCreateSessionInput, AuditSessionLike } from "./session";

export { runAnomalyChecks } from "./anomaly-runner";
export type { AnomalyContext } from "./anomaly-runner";
export type { AnomalyRuleResult } from "./anomaly-rules";
export {
  checkOffHours,
  checkRapidActions,
  checkUnknownClientOnProd,
  checkNewDevice,
  checkNewIP,
  checkSensitiveFromNewContext,
  checkImpossibleTravel,
} from "./anomaly-rules";
