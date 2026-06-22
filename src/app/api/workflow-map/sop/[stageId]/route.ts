/**
 * GET /api/workflow-map/sop/[stageId]
 *
 * Returns the SOP section content documenting a stage's automation, ordered to
 * match STAGE_TO_SOP[stageId]. Stages outside the Project pipeline (not in the
 * map) return an empty list with `projectOnly: false`.
 *
 * Auth is enforced by middleware: `/api/workflow-map` is prefix-allowlisted for
 * all roles (segment-boundary match), so this nested path is covered without an
 * extra allow-list entry.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STAGE_TO_SOP } from "@/lib/flow-map/sop-map";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ stageId: string }> },
) {
  const { stageId } = await params;
  const sectionIds = STAGE_TO_SOP[stageId];

  // Non-Project stage (no SOP mapping in this version).
  if (!sectionIds || sectionIds.length === 0) {
    return NextResponse.json({ sections: [], projectOnly: false });
  }

  if (!prisma) {
    return NextResponse.json({ sections: [], projectOnly: true });
  }

  const rows = await prisma.sopSection.findMany({
    where: { id: { in: sectionIds } },
    select: { id: true, content: true },
  });

  // Preserve STAGE_TO_SOP order; drop ids that have no row.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sections = sectionIds
    .map((id) => byId.get(id))
    .filter((r): r is { id: string; content: string } => Boolean(r));

  return NextResponse.json({ sections, projectOnly: true });
}
