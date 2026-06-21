import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { syncVishtikIds, liveDeps, acquireLock, releaseLock } from "@/lib/vishtik-sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Prod flag lives in SystemConfig (Vercel env cap workaround).
  const flag = prisma
    ? (await prisma.systemConfig.findUnique({ where: { key: "vishtik_sync_enabled" } }))?.value
    : undefined;
  if (flag !== "true") return NextResponse.json({ status: "disabled" });

  const now = new Date();
  const lockToken = await acquireLock(now);
  if (!lockToken) {
    return NextResponse.json({ status: "skipped", reason: "locked" });
  }

  let run: { id: string } | null = null;
  try {
    if (prisma) run = await prisma.vishtikSyncRun.create({ data: {} });
    const result = await syncVishtikIds({ dryRun: false }, liveDeps({ dryRun: false }));

    if (prisma && run) {
      await prisma.vishtikSyncRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          written: result.written,
          unmatchedCount: result.unmatchedCount,
          ambiguousCount: result.ambiguous.length,
          writeFailures: result.writeFailures,
          fetchedCount: result.fetchedCount,
          aborted: result.aborted ?? null,
          durationMs: result.durationMs,
        },
      });
    }
    if (result.aborted) {
      Sentry.captureMessage(`vishtik-id-sync aborted: ${result.aborted}`, "warning");
    } else if (result.writeFailures > 0) {
      Sentry.captureMessage(`vishtik-id-sync: ${result.writeFailures} write failures`, "warning");
    }
    return NextResponse.json({ status: "ok", timestamp: now.toISOString(), ...result });
  } catch (err) {
    Sentry.captureException(err);
    if (prisma && run) {
      await prisma.vishtikSyncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), aborted: "error" },
      }).catch(() => {});
    }
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  } finally {
    await releaseLock(lockToken); // compare-and-delete: only releases our own lock
  }
}
