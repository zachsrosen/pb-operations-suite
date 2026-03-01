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
  SESSION_INACTIVITY_TIMEOUT_MS,
} from "./session";

export type { GetOrCreateSessionInput } from "./session";
