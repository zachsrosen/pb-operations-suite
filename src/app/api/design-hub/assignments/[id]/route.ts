import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";

/** PATCH — clear an assignment. Idempotent: clearing a cleared row is a no-op. */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const row = await prisma.designAssignment.findUnique({ where: { id } });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Assignee or assigner only — one designer must not be able to clear
  // another's work off their queue. Case-insensitive because HubSpot and
  // Google can disagree on address casing.
  const email = auth.email.toLowerCase();
  const isOwner =
    row.assigneeEmail.toLowerCase() === email ||
    row.assignedBy.toLowerCase() === email;
  if (!isOwner && !auth.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Already cleared — return success rather than 409. A double-click on the
  // clear button should not surface an error to the user.
  if (row.clearedAt) {
    return NextResponse.json({ ok: true, alreadyCleared: true });
  }

  await prisma.designAssignment.update({
    where: { id },
    data: { clearedAt: new Date(), clearedBy: auth.email },
  });

  return NextResponse.json({ ok: true });
}
