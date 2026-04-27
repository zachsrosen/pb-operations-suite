import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { postEndOfSessionNote } from "@/lib/shit-show/hubspot-note";

/**
 * Manual retry for a previously-FAILED end-of-session HubSpot note post.
 * The HubSpot note module is idempotent; this clears the previous failure
 * and tries again.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  // Reset hubspotNoteId to null so the post is attempted again (the
  // postEndOfSessionNote function skips when hubspotNoteId is set).
  await prisma.shitShowSessionItem.update({
    where: { id },
    data: { hubspotNoteId: null, noteSyncStatus: "PENDING", noteSyncError: null },
  });
  const result = await postEndOfSessionNote(id);
  return NextResponse.json(result);
}
