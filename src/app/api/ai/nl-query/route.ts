/**
 * POST /api/ai/nl-query
 *
 * Converts a natural language query string into a typed ProjectFilterSpec.
 * The filter spec is applied client-side against the already-loaded projects
 * array — no project data is sent from client to server.
 *
 * Request body: { query: string }
 * Response:     { spec: ProjectFilterSpec }
 *
 * Guardrails:
 * - ADMIN / OWNER only
 * - Rate limited: 10 req/min per user
 * - Query string capped at AI_INPUT_LIMITS.nlQuery chars
 * - Strict Zod output schema — model MUST conform
 * - Safe fallback (empty spec) on any failure
 */

import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { requireApiAuth } from "@/lib/api-auth";
import {
  getAIClient,
  AI_MODEL,
  isAIAuthorized,
  isRateLimited,
  ProjectFilterSpecSchema,
  NL_QUERY_SYSTEM_PROMPT,
  AI_INPUT_LIMITS,
  EMPTY_FILTER_SPEC,
} from "@/lib/ai";
import { buildHeuristicFilterSpec, hasMeaningfulFilterSpec } from "@/lib/ai-nl-fallback";

export async function POST(request: NextRequest) {
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

  // --- Parse and validate request body ---
  let query: string;
  try {
    const body = await request.json();
    if (typeof body?.query !== "string" || !body.query.trim()) {
      return NextResponse.json(
        { error: "Request body must include a non-empty 'query' string." },
        { status: 400 }
      );
    }
    // Hard cap — truncate silently rather than rejecting
    query = body.query.trim().substring(0, AI_INPUT_LIMITS.nlQuery);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const openai = getAIClient();
    const { object } = await generateObject({
      model: openai(AI_MODEL),
      schema: ProjectFilterSpecSchema,
      system: NL_QUERY_SYSTEM_PROMPT,
      prompt: `Parse this query into a filter spec: "${query}"`,
      maxOutputTokens: 400,
      temperature: 0,
    });

    // If the model returns a valid but no-op spec, apply deterministic parsing
    // so obvious queries still work when the model is uncertain.
    if (!hasMeaningfulFilterSpec(object)) {
      const heuristic = buildHeuristicFilterSpec(query);
      if (hasMeaningfulFilterSpec(heuristic)) {
        return NextResponse.json({
          spec: heuristic,
          fallback: "heuristic",
        });
      }
    }

    return NextResponse.json({ spec: object });
  } catch (err) {
    console.error("[ai/nl-query] Error:", err);
    const heuristic = buildHeuristicFilterSpec(query);
    const message = err instanceof Error ? err.message : "Unknown error";

    // Safe fallback — deterministic parser first, then empty spec.
    if (hasMeaningfulFilterSpec(heuristic)) {
      return NextResponse.json({
        spec: heuristic,
        error: true,
        fallback: "heuristic",
        ...(process.env.NODE_ENV !== "production" ? { debug: message } : {}),
      });
    }

    return NextResponse.json({
      spec: {
        ...EMPTY_FILTER_SPEC,
        interpreted_as: "Could not parse query. Showing all projects.",
      },
      error: true,
      fallback: "empty",
      ...(process.env.NODE_ENV !== "production" ? { debug: message } : {}),
    });
  }
}
