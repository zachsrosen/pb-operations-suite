import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { batchSyncPipeline, syncPipelineConfigs } from "@/lib/deal-sync";
import type { DealPipeline } from "@/generated/prisma/enums";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  const hasAccess = !!currentUser?.roles?.some((r) => r === "ADMIN" || r === "OWNER");
  if (!currentUser || !hasAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const pipeline = body.pipeline as DealPipeline | undefined;
  const pipelines: DealPipeline[] = pipeline
    ? [pipeline]
    : ["PROJECT", "SALES", "DNR", "SERVICE", "ROOFING"];

  await syncPipelineConfigs();
  const results = [];
  for (const p of pipelines) {
    const result = await batchSyncPipeline(p);
    results.push(result);
  }

  return NextResponse.json({ results });
}
