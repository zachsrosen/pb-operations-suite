/**
 * POST /api/solar/projects/[id]/beacon
 *
 * Dirty-flag signal only (no data write).
 * Called via navigator.sendBeacon() on tab close.
 *
 * Accepts text/plain or application/json.
 * CSRF validated from body (sendBeacon can't set headers).
 * Origin validated: must match app origin (defense-in-depth for body-CSRF endpoint).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, validateCsrfBody, canWriteProject, checkSolarRateLimit } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  // Size guard — beacon should be tiny (~200 bytes)
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > 1024) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  // Origin must match our own origin (defense-in-depth — body CSRF is the primary check,
  // but Origin validation blocks cross-origin beacon attempts before parsing)
  const origin = req.headers.get("origin");
  const appOrigin = req.nextUrl.origin;
  if (!origin || origin !== appOrigin) {
    return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
  }

  // Parse body (supports text/plain from sendBeacon or application/json)
  let body: { csrfToken?: string; version?: number; dirtyFlag?: boolean };
  try {
    const text = await req.text();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // CSRF from body (sendBeacon can't set headers)
  const csrfError = validateCsrfBody(req, body.csrfToken);
  if (csrfError) return csrfError;

  // Auth
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const { role: userRole } = user;
  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  // Write access check
  const canWrite = await canWriteProject(user.id, userRole, id);
  if (!canWrite) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Upsert pending state — one per user per project
  if (body.dirtyFlag && body.version) {
    await prisma.solarPendingState.upsert({
      where: { projectId_userId: { projectId: id, userId: user.id } },
      update: { version: body.version, createdAt: new Date() },
      create: { projectId: id, userId: user.id, version: body.version },
    });
  }

  return NextResponse.json({ ok: true });
}
