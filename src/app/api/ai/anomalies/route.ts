/**
 * POST /api/ai/anomalies
 *
 * Detects non-obvious operational anomalies in the active project pipeline
 * using gpt-4o-mini. Fetches project data server-side (no client payload)
 * and sends a minimal, PII-free field set to the model.
 *
 * Guardrails:
 * - ADMIN / OWNER only
 * - Rate limited: 10 req/min per user
 * - Input capped at AI_INPUT_LIMITS.projectSummaryMax highest-priority projects
 * - Strict Zod output schema with safe fallback on parse failure
 */

import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { requireApiAuth } from "@/lib/api-auth";
import { fetchAllProjects, filterProjectsForContext, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { transformProject, type ApiProject } from "@/lib/executive-shared";
import {
  getAIClient,
  AI_MODEL,
  isAIAuthorized,
  isRateLimited,
  AnomalyInputProjectSchema,
  AnomalyResultSchema,
  ANOMALY_SYSTEM_PROMPT,
  AI_INPUT_LIMITS,
  type AnomalyInputProject,
} from "@/lib/ai";

// 15-minute server-side cache — anomaly insights don't need to be real-time
const anomalyCache = new Map<string, { result: unknown; ts: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Map a HubSpot Project to the ApiProject shape that transformProject() expects.
 * Both use the same camelCase field names — the difference is only that
 * ApiProject is the documented interface; Project is what HubSpot returns.
 */
function projectToApiProject(p: Project): ApiProject {
  return p as unknown as ApiProject;
}

export async function POST() {
  // --- Auth ---
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, role } = authResult;

  if (!isAIAuthorized(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- Rate limit ---
  if (isRateLimited(email)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  // --- Server-side result cache (shared across users) ---
  const cached = anomalyCache.get("anomalies");
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ ...(cached.result as object), cached: true });
  }

  try {
    // --- Fetch project data via existing cache layer ---
    const { data: rawProjects } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ACTIVE,
      () => fetchAllProjects({ activeOnly: true })
    );

    const execProjects = filterProjectsForContext(rawProjects ?? [], "executive")
      .map((p) => transformProject(projectToApiProject(p)))
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, AI_INPUT_LIMITS.projectSummaryMax);

    // --- Build minimal, PII-free payload ---
    // Project names include customer name after "|" — send only the internal
    // identifier portion (before "|") to avoid sending PII to OpenAI.
    const payload: AnomalyInputProject[] = execProjects.map((p) => ({
      id: p.id,
      name: (p.name.split("|")[0]?.trim() || p.id).substring(
        0,
        AI_INPUT_LIMITS.projectName
      ),
      stage: p.stage,
      pb_location: p.pb_location,
      priority_score: p.priority_score,
      days_to_install: p.days_to_install,
      days_to_inspection: p.days_to_inspection,
      days_to_pto: p.days_to_pto,
      days_since_close: p.days_since_close,
      is_participate_energy: p.is_participate_energy,
      is_rtb: p.is_rtb,
      estimated_install_days: p.estimated_install_days,
      has_design_approval: !!p.design_approval,
      has_construction_complete: !!p.construction_complete,
      has_inspection_pass: !!p.inspection_pass,
      has_pto_granted: !!p.pto_granted,
    }));

    // Strip any malformed items before sending to model
    const validPayload = payload.filter(
      (item) => AnomalyInputProjectSchema.safeParse(item).success
    );

    // --- Call model ---
    const openai = getAIClient();
    const { object } = await generateObject({
      model: openai(AI_MODEL),
      schema: AnomalyResultSchema,
      system: ANOMALY_SYSTEM_PROMPT,
      prompt: `Here are ${validPayload.length} active solar projects sorted by priority score (highest first). Identify non-obvious anomalies:\n\n${JSON.stringify(validPayload, null, 0)}`,
      maxOutputTokens: 1200,
      temperature: 0.2,
    });

    // Map project_id back to full project for URL linking
    const projectIndex = new Map(execProjects.map((p) => [p.id, p]));
    const anomaliesWithProjects = object.anomalies.map((a) => ({
      ...a,
      project: projectIndex.get(a.project_id),
    }));

    const result = {
      anomalies: anomaliesWithProjects,
      summary: object.summary,
    };

    anomalyCache.set("anomalies", { result, ts: Date.now() });
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    console.error("[ai/anomalies] Error:", err);
    // Safe fallback — never crash the alerts page
    return NextResponse.json(
      {
        anomalies: [],
        summary: "AI analysis temporarily unavailable.",
        cached: false,
        error: true,
      },
      { status: 200 }
    );
  }
}
