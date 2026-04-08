/**
 * /api/solar/projects
 *
 * POST — Create a new project
 * GET  — List projects (role-scoped)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, validateCsrfHeader, isElevatedRole, checkSolarRateLimit } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

// ── Schemas ────────────────────────────────────────────────

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  dealId: z.string().max(20).optional(),
  visibility: z.enum(["PRIVATE", "TEAM"]).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  equipmentConfig: z.any().optional(),
  stringsConfig: z.any().optional(),
  siteConditions: z.any().optional(),
  homeConsumptionConfig: z.any().optional(),
  batteryConfig: z.any().optional(),
  lossProfile: z.any().optional(),
  geoJsonUrl: z.string().url().optional(),
  radianceDxfUrl: z.string().url().optional(),
  shadeDataUrl: z.string().url().optional(),
});

// ── POST — Create project ──────────────────────────────────

export async function POST(req: NextRequest) {
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Size guard — 5MB max
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Payload too large (5MB max)" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const project = await prisma.solarProject.create({
    data: {
      name: data.name,
      address: data.address,
      dealId: data.dealId,
      lat: data.lat,
      lng: data.lng,
      visibility: data.visibility ?? undefined,
      createdById: user.id,
      equipmentConfig: data.equipmentConfig ?? undefined,
      stringsConfig: data.stringsConfig ?? undefined,
      siteConditions: data.siteConditions ?? undefined,
      homeConsumptionConfig: data.homeConsumptionConfig ?? undefined,
      batteryConfig: data.batteryConfig ?? undefined,
      lossProfile: data.lossProfile ?? undefined,
      geoJsonUrl: data.geoJsonUrl ?? undefined,
      radianceDxfUrl: data.radianceDxfUrl ?? undefined,
      shadeDataUrl: data.shadeDataUrl ?? undefined,
    },
  });

  return NextResponse.json({ data: project }, { status: 201 });
}

// ── GET — List projects (role-scoped) ──────────────────────

export async function GET(req: NextRequest) {
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status"); // DRAFT, ACTIVE, ARCHIVED, ALL
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const skip = (page - 1) * limit;

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // Status filter — exclude ARCHIVED by default
  if (statusFilter === "ALL") {
    // No status filter
  } else if (statusFilter === "ARCHIVED") {
    where.status = "ARCHIVED";
  } else if (statusFilter && ["DRAFT", "ACTIVE"].includes(statusFilter)) {
    where.status = statusFilter;
  } else {
    // Default: exclude archived
    where.status = { not: "ARCHIVED" };
  }

  // Role-based scoping
  if (!isElevatedRole(user.role)) {
    // Non-elevated users see: own projects + TEAM-visibility + projects shared with them
    where.OR = [
      { createdById: user.id },
      { visibility: "TEAM" },
      { shares: { some: { userId: user.id } } },
    ];
  }

  const [projects, total] = await Promise.all([
    prisma.solarProject.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        status: true,
        visibility: true,
        version: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.solarProject.count({ where }),
  ]);

  return NextResponse.json({
    data: projects,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
