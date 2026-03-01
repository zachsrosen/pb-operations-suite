/**
 * Anomaly detection rules -- pure functions.
 * Each returns AnomalyRuleResult indicating whether the rule triggered.
 */

export interface AnomalyRuleResult {
  triggered: boolean;
  rule: string;
  riskScore: number;
  evidence: Record<string, unknown>;
}

const NO_TRIGGER = (rule: string): AnomalyRuleResult => ({
  triggered: false,
  rule,
  riskScore: 0,
  evidence: {},
});

/**
 * Off-hours: 10pm-5am America/Denver.
 */
export function checkOffHours(now: Date): AnomalyRuleResult {
  const denverTime = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Denver" })
  );
  const hour = denverTime.getHours();

  if (hour >= 22 || hour < 5) {
    return {
      triggered: true,
      rule: "off_hours",
      riskScore: 1,
      evidence: { hour, denverTime: denverTime.toISOString() },
    };
  }
  return NO_TRIGGER("off_hours");
}

/**
 * Rapid-fire: >20 mutating actions in 5 minutes.
 */
export function checkRapidActions(
  mutatingActionCount: number
): AnomalyRuleResult {
  if (mutatingActionCount > 20) {
    return {
      triggered: true,
      rule: "rapid_actions",
      riskScore: 2,
      evidence: { mutatingActionCount, threshold: 20, windowMinutes: 5 },
    };
  }
  return NO_TRIGGER("rapid_actions");
}

/**
 * Unknown client type on production.
 */
export function checkUnknownClientOnProd(
  clientType: string,
  environment: string
): AnomalyRuleResult {
  if (clientType === "UNKNOWN" && environment === "PRODUCTION") {
    return {
      triggered: true,
      rule: "unknown_client",
      riskScore: 2,
      evidence: { clientType, environment },
    };
  }
  return NO_TRIGGER("unknown_client");
}

/**
 * New device: fingerprint not seen for this user in last 30 days.
 */
export function checkNewDevice(
  fingerprintKnown: boolean,
  fingerprint: string | null
): AnomalyRuleResult {
  if (fingerprint && !fingerprintKnown) {
    return {
      triggered: true,
      rule: "new_device",
      riskScore: 2,
      evidence: { fingerprint },
    };
  }
  return NO_TRIGGER("new_device");
}

/**
 * New IP on production: IP not seen for user in 30 days.
 */
export function checkNewIP(
  ipKnown: boolean,
  ipAddress: string,
  environment: string
): AnomalyRuleResult {
  if (environment === "PRODUCTION" && !ipKnown) {
    return {
      triggered: true,
      rule: "new_ip",
      riskScore: 2,
      evidence: { ipAddress },
    };
  }
  return NO_TRIGGER("new_ip");
}

/**
 * Sensitive action from new context: HIGH-risk action + new device or new IP.
 */
export function checkSensitiveFromNewContext(
  activityRiskScore: number,
  hasNewDeviceAnomaly: boolean,
  hasNewIPAnomaly: boolean
): AnomalyRuleResult {
  if (activityRiskScore >= 3 && (hasNewDeviceAnomaly || hasNewIPAnomaly)) {
    return {
      triggered: true,
      rule: "sensitive_from_new_context",
      riskScore: 3,
      evidence: { activityRiskScore, hasNewDeviceAnomaly, hasNewIPAnomaly },
    };
  }
  return NO_TRIGGER("sensitive_from_new_context");
}

/**
 * Impossible travel -- stub (Amendment A6).
 * TODO: implement with geo-IP provider
 */
export function checkImpossibleTravel(): AnomalyRuleResult {
  return NO_TRIGGER("impossible_travel");
}
