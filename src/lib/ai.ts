/**
 * AI Foundation
 *
 * Shared Vercel AI SDK client, Zod output schemas, and guardrails
 * for all /api/ai/* routes. Uses gpt-4o-mini via OpenAI provider —
 * cheap, fast, and accurate enough for structured extraction tasks.
 *
 * Guardrails enforced here (not per-route):
 * - Role check: ADMIN | OWNER only
 * - Max input length per field
 * - Strict Zod output schemas
 * - Simple in-memory rate limiter (per-user, per-minute)
 * - Safe fallback values when parsing fails
 */

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

// ============================================================
// Client
// ============================================================

/**
 * Lazy-initialized OpenAI provider. Throws at call-time (not import-time)
 * so missing env doesn't crash cold starts for non-AI routes.
 */
export function getAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return createOpenAI({ apiKey });
}

export const AI_MODEL = "gpt-4o-mini";

// ============================================================
// Role guard
// ============================================================

const AI_ALLOWED_ROLES = new Set(["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"]);

export function isAIAuthorized(role: string): boolean {
  return AI_ALLOWED_ROLES.has(role);
}

// ============================================================
// Rate limiter — simple in-memory sliding window
// ============================================================

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // per user per minute

/**
 * Returns true if the request should be blocked.
 * Key is typically the user's email address.
 */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(key) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) return true;
  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return false;
}

// ============================================================
// Input limits (chars)
// ============================================================

export const AI_INPUT_LIMITS = {
  nlQuery: 500, // Natural language query string
  projectName: 120, // Per-project name field sent to model
  projectSummaryMax: 80, // Max projects in anomaly payload
} as const;

// ============================================================
// Zod schemas — Feature 1: Anomaly Detection
// ============================================================

/**
 * A minimal project summary sent to the model for anomaly detection.
 * NO customer PII — only operational metrics and internal identifiers.
 */
export const AnomalyInputProjectSchema = z.object({
  id: z.string(),
  name: z.string().max(AI_INPUT_LIMITS.projectName),
  stage: z.string(),
  pb_location: z.string(),
  priority_score: z.number(),
  days_to_install: z.number().nullable(),
  days_to_inspection: z.number().nullable(),
  days_to_pto: z.number().nullable(),
  days_since_close: z.number(),
  is_participate_energy: z.boolean(),
  is_rtb: z.boolean(),
  estimated_install_days: z.number(),
  has_design_approval: z.boolean(),
  has_construction_complete: z.boolean(),
  has_inspection_pass: z.boolean(),
  has_pto_granted: z.boolean(),
});

export type AnomalyInputProject = z.infer<typeof AnomalyInputProjectSchema>;

export const AnomalyResultSchema = z.object({
  anomalies: z.array(
    z.object({
      project_id: z.string(),
      severity: z.enum(["critical", "warning", "info"]),
      title: z.string().max(80),
      reason: z.string().max(250),
    })
  ),
  summary: z.string().max(400),
});

export type AnomalyResult = z.infer<typeof AnomalyResultSchema>;

// ============================================================
// Zod schemas — Feature 2: NL Query → Filter Spec
// ============================================================

/**
 * Typed filter spec returned by the NL query route.
 * Applied client-side against the already-loaded projects array.
 */
export const ProjectFilterSpecSchema = z.object({
  locations: z.array(z.string()).optional(),
  stages: z.array(z.string()).optional(),
  is_pe: z.boolean().optional(),
  is_rtb: z.boolean().optional(),
  is_overdue: z.boolean().optional(), // any milestone overdue
  max_days_to_install: z.number().optional(),
  min_days_to_install: z.number().optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  min_priority_score: z.number().optional(),
  sort_by: z
    .enum([
      "priority_score",
      "days_to_install",
      "days_to_inspection",
      "days_to_pto",
      "amount",
      "days_since_close",
    ])
    .optional(),
  sort_dir: z.enum(["asc", "desc"]).optional(),
  interpreted_as: z.string().max(200), // human-readable description of what was parsed
});

export type ProjectFilterSpec = z.infer<typeof ProjectFilterSpecSchema>;

/** Empty filter spec — means "show everything, don't change sort" */
export const EMPTY_FILTER_SPEC: ProjectFilterSpec = {
  interpreted_as: "",
};

// ============================================================
// System prompts
// ============================================================

export const ANOMALY_SYSTEM_PROMPT = `You are an operations analyst for a solar installation company.
You receive a list of active solar projects with their milestone timelines and operational metrics.
Your job is to identify genuine anomalies — non-obvious patterns that rule-based alerts would miss.

Focus on:
- Projects stalled in a stage far longer than typical (e.g. in Design for 90+ days with no milestones complete)
- Projects with contradictory signals (e.g. high priority score but already has construction_complete — may be stale)
- Clusters: multiple projects in same location all overdue — suggests systemic issue vs one-off
- PE projects at risk of missing PTO milestone but not yet flagged as overdue
- RTB projects that have been RTB for a very long time (days_since_close high, is_rtb true, no install date progress)

Do NOT repeat alerts that are obvious from days_to_install < 0 alone — those are already shown separately.
Keep titles concise (≤ 10 words). Keep reasons specific and actionable (≤ 40 words).
Return 0–8 anomalies. If nothing non-obvious stands out, return an empty array with a brief summary saying so.`;

export const NL_QUERY_SYSTEM_PROMPT = `You are a filter parser for a solar project pipeline dashboard.
Convert natural language queries into a structured filter spec.

Available locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo
Available stages: Site Survey, Design & Engineering, Permitting & Interconnection, RTB - Blocked, Ready To Build, Construction, Inspection, Permission To Operate, Close Out

Rules:
- Only set fields that are clearly implied by the query. Leave others undefined.
- "overdue" means any milestone (install, inspection, or PTO) is past its forecast date
- "PE" or "participate energy" → is_pe: true
- "RTB" or "ready to build" → is_rtb: true
- Dollar amounts: interpret "30k" as 30000, "100k" as 100000, "1M" as 1000000
- If you cannot confidently parse the query, return only interpreted_as explaining the limitation
- interpreted_as must always be set — describe in plain English what filters you applied`;
