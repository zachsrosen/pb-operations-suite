/**
 * GET /api/admin/workflows/templates — List available templates.
 * POST /api/admin/workflows/templates — Create a new DRAFT workflow from a template.
 *   Body: { slug: string, name?: string }
 *
 * ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import { TEMPLATES, getTemplateBySlug } from "@/lib/admin-workflows/templates";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) return { error: NextResponse.json({ error: "Admin required" }, { status: 403 }) };
  return { user, session };
}

export async function GET() {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const a = await requireAdmin();
  if ("error" in a) return a.error;

  return NextResponse.json({
    templates: TEMPLATES.map((t) => ({
      slug: t.slug,
      name: t.name,
      summary: t.summary,
      useCase: t.useCase,
      triggerType: t.triggerType,
      stepCount: t.definition.steps.length,
    })),
  });
}

const postSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
});

export async function POST(request: NextRequest) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const a = await requireAdmin();
  if ("error" in a) return a.error;
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const template = getTemplateBySlug(body.slug);
  if (!template) {
    return NextResponse.json({ error: `Template not found: ${body.slug}` }, { status: 404 });
  }

  const created = await prisma.adminWorkflow.create({
    data: {
      name: body.name ?? template.name,
      description: template.summary,
      status: "DRAFT",
      triggerType: template.triggerType,
      triggerConfig: template.triggerConfig as object,
      definition: template.definition as object,
      createdById: a.user.id,
    },
  });

  return NextResponse.json({ workflow: created });
}
