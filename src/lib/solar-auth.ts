/**
 * Solar Surveyor — Auth & CSRF Utilities
 *
 * Shared helpers for all /api/solar/* route handlers.
 * Provides:
 *  - Session validation (wraps existing requireApiAuth)
 *  - CSRF double-submit cookie validation
 *  - Role-based access helpers (admin/manager/owner vs regular users)
 *  - Project-level access control (visibility + shares)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth, type AuthenticatedUser } from "./api-auth";
import { prisma } from "./db";
import type { UserRole } from "@/generated/prisma/enums";

// ── Roles that have elevated Solar access ──────────────────
const ELEVATED_ROLES: UserRole[] = ["ADMIN", "MANAGER", "EXECUTIVE"];

// ── Rate Limiter — in-memory sliding window ────────────────
// NOTE: This limiter is process-local. On serverless platforms (Vercel),
// each function instance maintains its own Map, so the effective limit is
// 60 req/min *per instance* rather than globally. For this internal tool
// with a small user base, that's acceptable. If stricter global enforcement
// is needed, replace with Redis (e.g. Upstash) or Vercel KV.
const solarRateLimitMap = new Map<string, number[]>();
const SOLAR_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const SOLAR_RATE_LIMIT_MAX = 60; // 60 req/min per user

/**
 * Returns 429 response if rate limited, null if allowed.
 * Key is typically the user email.
 */
export function checkSolarRateLimit(key: string): NextResponse | null {
  const now = Date.now();
  const timestamps = (solarRateLimitMap.get(key) ?? []).filter(
    (t) => now - t < SOLAR_RATE_LIMIT_WINDOW_MS
  );
  if (timestamps.length >= SOLAR_RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }
  timestamps.push(now);
  solarRateLimitMap.set(key, timestamps);
  return null;
}

export function isElevatedRole(role: string): boolean {
  // Normalize legacy OWNER → EXECUTIVE (enum was renamed)
  const normalized = role === "OWNER" ? "EXECUTIVE" : role;
  return ELEVATED_ROLES.includes(normalized as UserRole);
}

// ── CSRF Validation ────────────────────────────────────────

/**
 * Validate CSRF token from X-CSRF-Token header against csrf_token cookie.
 * Returns error response if invalid, null if valid.
 */
export function validateCsrfHeader(req: NextRequest): NextResponse | null {
  const cookieToken = req.cookies.get("csrf_token")?.value;
  const headerToken = req.headers.get("x-csrf-token");

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return NextResponse.json(
      { error: "CSRF validation failed" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Validate CSRF token from request body (for sendBeacon which can't set headers).
 * Expects { csrfToken } in parsed body.
 */
export function validateCsrfBody(
  req: NextRequest,
  csrfToken: string | undefined
): NextResponse | null {
  const cookieToken = req.cookies.get("csrf_token")?.value;

  if (!cookieToken || !csrfToken || cookieToken !== csrfToken) {
    return NextResponse.json(
      { error: "CSRF validation failed" },
      { status: 403 }
    );
  }
  return null;
}

// ── Auth + User Resolution ─────────────────────────────────

export interface SolarUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/**
 * Authenticate the request and resolve the full user record.
 * Returns [user, null] on success, [null, errorResponse] on failure.
 */
export async function requireSolarAuth(
  _req?: NextRequest
): Promise<[SolarUser, null] | [null, NextResponse]> {
  const authResult = await requireApiAuth();

  if (authResult instanceof NextResponse) {
    return [null, authResult];
  }

  const auth = authResult as AuthenticatedUser;

  // Resolve user ID from email
  if (!prisma) {
    return [
      null,
      NextResponse.json({ error: "Database unavailable" }, { status: 503 }),
    ];
  }

  const user = await prisma.user.findUnique({
    where: { email: auth.email },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    return [
      null,
      NextResponse.json({ error: "User not found" }, { status: 404 }),
    ];
  }

  return [user as SolarUser, null];
}

// ── Project Access Control ─────────────────────────────────

/**
 * Check if user can read a project.
 *
 * Rules:
 * - ADMIN/MANAGER/OWNER: can read all projects
 * - TEAM visibility: all authenticated users can read
 * - PRIVATE visibility: only creator or users in SolarProjectShare
 */
export async function canReadProject(
  userId: string,
  role: string,
  projectId: string
): Promise<boolean> {
  if (!prisma) return false;

  const project = await prisma.solarProject.findUnique({
    where: { id: projectId },
    select: {
      createdById: true,
      visibility: true,
    },
  });

  if (!project) return false;
  if (isElevatedRole(role)) return true;
  if (project.visibility === "TEAM") return true;
  if (project.createdById === userId) return true;

  // Check shares
  const share = await prisma.solarProjectShare.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });

  return !!share;
}

/**
 * Check if user can write (PUT/beacon) to a project.
 *
 * Rules:
 * - ADMIN/MANAGER/OWNER: can write all projects
 * - Creator: can write own projects
 * - TEAM visibility: only creator or elevated roles can write (no share-based write)
 * - PRIVATE visibility + SolarProjectShare with EDIT permission: can write
 */
export async function canWriteProject(
  userId: string,
  role: string,
  projectId: string
): Promise<boolean> {
  if (!prisma) return false;

  const project = await prisma.solarProject.findUnique({
    where: { id: projectId },
    select: { createdById: true, visibility: true },
  });

  if (!project) return false;
  if (isElevatedRole(role)) return true;
  if (project.createdById === userId) return true;

  // TEAM-visibility projects: only creator or elevated roles can write.
  // EDIT shares only grant write access on PRIVATE-visibility projects.
  if (project.visibility === "TEAM") return false;

  // Check shares — only EDIT permission grants write access (PRIVATE projects only)
  const share = await prisma.solarProjectShare.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { permission: true },
  });

  return share?.permission === "EDIT";
}

/**
 * Check if user can archive (DELETE) a project.
 *
 * Rules:
 * - ADMIN/MANAGER/OWNER: can archive any project
 * - Creator: can archive own projects
 * - Shared EDIT users: CANNOT archive
 */
export async function canArchiveProject(
  userId: string,
  role: string,
  projectId: string
): Promise<boolean> {
  if (!prisma) return false;

  const project = await prisma.solarProject.findUnique({
    where: { id: projectId },
    select: { createdById: true },
  });

  if (!project) return false;
  if (isElevatedRole(role)) return true;
  return project.createdById === userId;
}

// ── Full Project Snapshot ──────────────────────────────────

/**
 * Build a full project snapshot for revision storage.
 * Includes all persisted fields — name, address, lat/lng, status,
 * visibility, file URLs, and all config JSON fields.
 * Excludes: id, createdById, createdAt, updatedAt, version (metadata).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildProjectSnapshot(project: any): any {
  return {
    name: project.name,
    address: project.address,
    lat: project.lat,
    lng: project.lng,
    status: project.status,
    visibility: project.visibility,
    equipmentConfig: project.equipmentConfig,
    stringsConfig: project.stringsConfig,
    siteConditions: project.siteConditions,
    homeConsumptionConfig: project.homeConsumptionConfig,
    batteryConfig: project.batteryConfig,
    lossProfile: project.lossProfile,
    geoJsonUrl: project.geoJsonUrl,
    radianceDxfUrl: project.radianceDxfUrl,
    shadeDataUrl: project.shadeDataUrl,
  };
}
