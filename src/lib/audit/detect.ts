/**
 * Audit detection utilities for environment, client type, and risk level.
 *
 * Types are defined as string literal unions matching the Prisma enums
 * (ClientType, Environment, RiskLevel) so this module works without
 * a generated Prisma client.
 */

// ---------------------------------------------------------------------------
// Local type aliases (mirror Prisma enums)
// ---------------------------------------------------------------------------
type ClientType = "BROWSER" | "CLAUDE_CODE" | "CODEX" | "API_CLIENT" | "UNKNOWN";
type Environment = "LOCAL" | "PREVIEW" | "PRODUCTION";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------
export const RISK_SCORES: Record<RiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const RISK_LEVELS_BY_SCORE: Record<number, RiskLevel> = {
  1: "LOW",
  2: "MEDIUM",
  3: "HIGH",
  4: "CRITICAL",
};

// ---------------------------------------------------------------------------
// Activity → Risk mapping
// ---------------------------------------------------------------------------
export const ACTIVITY_RISK_MAP: Record<string, RiskLevel> = {
  // Critical
  USER_DELETED: "CRITICAL",
  SETTINGS_CHANGED: "CRITICAL",
  // High
  USER_ROLE_CHANGED: "HIGH",
  USER_PERMISSIONS_CHANGED: "HIGH",
  USER_CREATED: "HIGH",
  ROLE_CAPABILITIES_CHANGED: "HIGH",
  ROLE_CAPABILITIES_RESET: "HIGH",
  // Medium
  AVAILABILITY_CHANGED: "MEDIUM",
  DATA_EXPORTED: "MEDIUM",
  CSV_DOWNLOADED: "MEDIUM",
  REPORT_EXPORTED: "MEDIUM",
  HUBSPOT_DEAL_UPDATED: "MEDIUM",
};

const DEFAULT_RISK_LEVEL: RiskLevel = "LOW";

export function getActivityRiskLevel(activityType: string): {
  riskLevel: RiskLevel;
  riskScore: number;
} {
  const riskLevel = ACTIVITY_RISK_MAP[activityType] ?? DEFAULT_RISK_LEVEL;
  return { riskLevel, riskScore: RISK_SCORES[riskLevel] };
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------
export function detectEnvironment(): Environment {
  const vercelEnv = process.env.VERCEL_ENV;

  if (vercelEnv === "production") return "PRODUCTION";
  if (vercelEnv === "preview") return "PREVIEW";

  // No VERCEL_ENV — fall back to NODE_ENV
  if (!vercelEnv && process.env.NODE_ENV === "production") return "PRODUCTION";

  return "LOCAL";
}

// ---------------------------------------------------------------------------
// Client type detection
// ---------------------------------------------------------------------------
interface ClientTypeContext {
  userAgent: string | null;
  xClientType: string | null;
  hasValidSession: boolean;
}

const VALID_CLIENT_TYPES = new Set<ClientType>([
  "BROWSER",
  "CLAUDE_CODE",
  "CODEX",
  "API_CLIENT",
  "UNKNOWN",
]);

export function detectClientType(ctx: ClientTypeContext): ClientType {
  // Priority 1: Explicit X-Client-Type header (only trusted with valid session)
  if (ctx.xClientType && ctx.hasValidSession) {
    const normalized = ctx.xClientType.toUpperCase().replace(/-/g, "_") as ClientType;
    if (VALID_CLIENT_TYPES.has(normalized)) return normalized;
  }

  const ua = ctx.userAgent ?? "";

  // Priority 2: AI agent UA patterns
  if (/claude[-_]?code|anthropic/i.test(ua)) return "CLAUDE_CODE";
  if (/codex|openai/i.test(ua)) return "CODEX";

  // Priority 3: Browser UA
  if (/Mozilla|Chrome|Safari|Firefox|Edge|Opera/i.test(ua)) return "BROWSER";

  // Priority 4: No session + non-browser UA → API client
  if (!ctx.hasValidSession && ua) return "API_CLIENT";

  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// IP utilities
// ---------------------------------------------------------------------------
const PRIVATE_KEYWORDS = new Set(["127.0.0.1", "::1", "localhost", "unknown"]);

/**
 * Returns true if `ip` is a private / loopback / unknown address.
 */
export function isPrivateIP(ip: string): boolean {
  // Strip ::ffff: IPv4-mapped prefix
  const normalized = ip.replace(/^::ffff:/i, "");

  if (PRIVATE_KEYWORDS.has(normalized.toLowerCase())) return true;

  // 10.x.x.x
  if (/^10\./.test(normalized)) return true;
  // 192.168.x.x
  if (/^192\.168\./.test(normalized)) return true;
  // 172.16.0.0 – 172.31.255.255
  const match172 = normalized.match(/^172\.(\d+)\./);
  if (match172) {
    const second = parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}

/**
 * Masks an IP address for privacy:
 *  - IPv4: "***.***.***.42"
 *  - ::ffff:IPv4: handled as IPv4
 *  - IPv6: mask all but the last segment
 */
export function maskIP(ip: string): string {
  // Handle ::ffff: mapped IPv4
  const ffmpPrefix = ip.match(/^(::ffff:)/i);
  const raw = ffmpPrefix ? ip.slice(ffmpPrefix[1].length) : ip;

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) {
    const lastOctet = raw.split(".").pop();
    return `***.***.***.${lastOctet}`;
  }

  // IPv6 — mask all but last segment
  if (raw.includes(":")) {
    const segments = raw.split(":");
    const last = segments.pop();
    const masked = segments.map(() => "****").join(":");
    return `${masked}:${last}`;
  }

  // Fallback: return as-is (localhost, unknown, etc.)
  return ip;
}
