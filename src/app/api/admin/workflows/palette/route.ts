/**
 * GET /api/admin/workflows/palette
 *
 * Returns the available actions + triggers for the editor to render.
 * ADMIN only.
 */

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import { ACTIONS } from "@/lib/admin-workflows/actions";
import { TRIGGERS } from "@/lib/admin-workflows/triggers";

export async function GET() {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  return NextResponse.json({
    actions: ACTIONS.map((a) => ({
      kind: a.kind,
      name: a.name,
      description: a.description,
      category: a.category,
      fields: a.fields,
    })),
    triggers: TRIGGERS.map((t) => ({
      kind: t.kind,
      name: t.name,
      description: t.description,
      fields: t.fields,
    })),
  });
}
