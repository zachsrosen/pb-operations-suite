/**
 * GET /api/workflow-map
 *
 * Returns the rendered Workflow Map snapshot for all authenticated users.
 * Auth is enforced by middleware (route allow-listed for all roles); no
 * in-route role check. Returns `{ empty: true }` if a sync has never run.
 */

import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/flow-map/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const snap = await getSnapshot();
  return NextResponse.json(snap ?? { empty: true });
}
