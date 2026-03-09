/**
 * /api/solar/projects/[id]
 *
 * GET    — Load a project
 * PUT    — Update a project (with optional revision creation)
 * DELETE — Archive a project (soft delete)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireSolarAuth,
  validateCsrfHeader,
  checkSolarRateLimit,
  canReadProject,
  canWriteProject,
  canArchiveProject,
  buildProjectSnapshot,
} from "@/lib/solar-auth";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

// ── Schemas ────────────────────────────────────────────────

const UpdateProjectSchema = z.object({
  version: z.number().int().positive(),
  createRevision: z.boolean().optional().default(false),
  forceOverwrite: z.boolean().optional().default(false),
  revisionNote: z.string().max(500).optional(),
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  status: z.enum(["DRAFT", "ACTIVE"]).optional(),
  visibility: z.enum(["PRIVATE", "TEAM"]).optional(),
  equipmentConfig: z.any().optional(),
  stringsConfig: z.any().optional(),
  siteConditions: z.any().optional(),
  homeConsumptionConfig: z.any().optional(),
  batteryConfig: z.any().optional(),
  lossProfile: z.any().optional(),
  geoJsonUrl: z.string().url().optional(),
  radianceDxfUrl: z.string().url().optional(),
  shadeDataUrl: z.string().url().optional(),
  scenarios: z.any().optional(),
  analysisResults: z.any().optional(),
});

// ── GET — Load project ─────────────────────────────────────

export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const canRead = await canReadProject(user.id, user.role, id);
  if (!canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const project = await prisma.solarProject.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true, email: true } },
      revisions: {
        where: { analysisResults: { not: Prisma.DbNull } },
        select: { analysisResults: true },
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const revisions = Array.isArray(project.revisions) ? project.revisions : [];
  const latestAnalysisResults = revisions[0]?.analysisResults ?? null;
  const { revisions: _revisions, ...projectData } = project;

  return NextResponse.json({
    data: {
      ...projectData,
      analysisResults: latestAnalysisResults,
    },
  });
}

// ── PUT — Update project ───────────────────────────────────

export async function PUT(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  const canWrite = await canWriteProject(user.id, user.role, id);
  if (!canWrite) {
    return NextResponse.json({ error: "Forbidden — no write access" }, { status: 403 });
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

  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Optimistic concurrency check
  const current = await prisma.solarProject.findUnique({
    where: { id },
    select: {
      version: true,
      updatedAt: true,
      updatedBy: { select: { name: true, email: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!current) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (current.version !== data.version && !data.forceOverwrite) {
    // Use updatedBy if available, otherwise fall back to createdBy
    const lastUpdater = current.updatedBy || current.createdBy;
    return NextResponse.json(
      {
        error: "Version conflict",
        serverVersion: current.version,
        serverUpdatedAt: current.updatedAt,
        serverUpdatedBy: lastUpdater.name || lastUpdater.email,
        conflictSummary: `Project was updated to version ${current.version}. Your version: ${data.version}.`,
      },
      { status: 409 }
    );
  }

  // If force overwrite, snapshot the current state before clobbering.
  // Uses upsert to avoid unique-constraint (projectId, version) crash
  // when a revision already exists for this version.
  let replacedMeta: { version: number; updatedAt: Date; updatedBy: string } | null = null;
  if (data.forceOverwrite && current.version !== data.version) {
    const currentFull = await prisma.solarProject.findUnique({ where: { id } });
    if (currentFull) {
      const snapshot = buildProjectSnapshot(currentFull);
      const note = `FORCED_OVERWRITE by ${user.name || user.email} at ${new Date().toISOString()}`;
      await prisma.solarProjectRevision.upsert({
        where: { projectId_version: { projectId: id, version: current.version } },
        create: {
          projectId: id,
          version: current.version,
          snapshot,
          createdById: user.id,
          note,
        },
        // On conflict: only update snapshot (latest state).
        // Preserve original createdById and note to maintain audit integrity.
        update: {
          snapshot,
        },
      });
      const lastUpdater = current.updatedBy || current.createdBy;
      replacedMeta = {
        version: current.version,
        updatedAt: current.updatedAt,
        updatedBy: lastUpdater.name || lastUpdater.email || "unknown",
      };
    }
  }

  const newVersion = current.version + 1;

  // Build update payload — only include fields that were sent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = { version: newVersion, updatedById: user.id };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.lat !== undefined) updateData.lat = data.lat;
  if (data.lng !== undefined) updateData.lng = data.lng;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.visibility !== undefined) updateData.visibility = data.visibility;
  if (data.equipmentConfig !== undefined) updateData.equipmentConfig = data.equipmentConfig;
  if (data.stringsConfig !== undefined) updateData.stringsConfig = data.stringsConfig;
  if (data.siteConditions !== undefined) updateData.siteConditions = data.siteConditions;
  if (data.homeConsumptionConfig !== undefined) updateData.homeConsumptionConfig = data.homeConsumptionConfig;
  if (data.batteryConfig !== undefined) updateData.batteryConfig = data.batteryConfig;
  if (data.lossProfile !== undefined) updateData.lossProfile = data.lossProfile;
  if (data.geoJsonUrl !== undefined) updateData.geoJsonUrl = data.geoJsonUrl;
  if (data.radianceDxfUrl !== undefined) updateData.radianceDxfUrl = data.radianceDxfUrl;
  if (data.shadeDataUrl !== undefined) updateData.shadeDataUrl = data.shadeDataUrl;
  if (data.scenarios !== undefined) updateData.scenarios = data.scenarios;

  const updated = await prisma.solarProject.update({
    where: { id },
    data: updateData,
  });

  // Optionally create a revision
  if (data.createRevision) {
    await prisma.solarProjectRevision.create({
      data: {
        projectId: id,
        version: newVersion,
        snapshot: buildProjectSnapshot(updated),
        analysisResults: data.analysisResults ?? undefined,
        createdById: user.id,
        note: data.revisionNote || null,
      },
    });
  }

  return NextResponse.json({
    data: {
      ...updated,
      analysisResults: data.analysisResults ?? null,
    },
    ...(replacedMeta ? { replaced: replacedMeta } : {}),
  });
}

// ── DELETE — Archive project ───────────────────────────────

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const rateLimitedDel = checkSolarRateLimit(user.email);
  if (rateLimitedDel) return rateLimitedDel;

  const canArchive = await canArchiveProject(user.id, user.role, id);
  if (!canArchive) {
    return NextResponse.json({ error: "Forbidden — only creator or admin can archive" }, { status: 403 });
  }

  const project = await prisma.solarProject.update({
    where: { id },
    data: { status: "ARCHIVED" },
  });

  return NextResponse.json({ data: { id: project.id, status: project.status } });
}
