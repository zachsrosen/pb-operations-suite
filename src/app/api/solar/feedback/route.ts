/**
 * /api/solar/feedback
 *
 * POST — Submit feedback
 * GET  — List feedback (ADMIN/MANAGER only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, validateCsrfHeader, isElevatedRole, checkSolarRateLimit } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const CreateFeedbackSchema = z.object({
  category: z.enum(["BUG", "FEATURE", "EQUIPMENT", "GENERAL"]),
  message: z.string().min(1).max(5000),
  projectId: z.string().optional(),
  context: z.any().optional(),
});

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const feedback = await prisma.solarFeedback.create({
    data: {
      userId: user.id,
      category: data.category,
      message: data.message,
      projectId: data.projectId || null,
      context: data.context ?? undefined,
    },
  });

  return NextResponse.json({ data: feedback }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!isElevatedRole(user.role)) {
    return NextResponse.json({ error: "Forbidden — admin/manager only" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));

  // Validate enum filters
  const VALID_CATEGORIES = ["BUG", "FEATURE", "EQUIPMENT", "GENERAL"];
  const VALID_STATUSES = ["NEW", "REVIEWED", "RESOLVED", "WONTFIX"];

  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `Invalid category. Allowed: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (category) where.category = category;
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.solarFeedback.findMany({
      where,
      include: {
        user: { select: { name: true, email: true } },
        project: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.solarFeedback.count({ where }),
  ]);

  return NextResponse.json({
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
