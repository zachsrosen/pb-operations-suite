/**
 * Sync helpers shared between the cron, the backfill API, and the local
 * `scripts/aircall-backfill.ts`. All Aircall data hits Postgres through here.
 */

import { aircall, type AircallCall } from "@/lib/aircall";
import { mapCallToCacheRow } from "@/lib/aircall-webhook";
import { prisma } from "@/lib/db";

export interface SyncResult {
  pages: number;
  upserted: number;
  errors: number;
  durationMs: number;
}

/** Pull all calls in [from, to) and upsert to AircallCallCache. */
export async function syncCallsRange(from: Date, to: Date, opts: { pageDelayMs?: number } = {}): Promise<SyncResult> {
  const start = Date.now();
  let pages = 0;
  let upserted = 0;
  let errors = 0;

  for await (const calls of aircall.iterateCalls({ from, to, perPage: 50, pageDelayMs: opts.pageDelayMs ?? 1100 })) {
    pages += 1;
    for (const call of calls) {
      try {
        const row = mapCallToCacheRow(call);
        await prisma.aircallCallCache.upsert({
          where: { id: row.id },
          create: row,
          update: row,
        });
        upserted += 1;
      } catch (err) {
        errors += 1;
        console.error("[aircall-sync] upsert failed for call", (call as AircallCall).id, err);
      }
    }
  }

  return { pages, upserted, errors, durationMs: Date.now() - start };
}

export interface UserSyncResult {
  total: number;
  upserted: number;
  durationMs: number;
}

/** Refresh full user roster into AircallUserCache. */
export async function syncUsers(): Promise<UserSyncResult> {
  const start = Date.now();
  let page = 1;
  let upserted = 0;
  let total = 0;
  while (true) {
    const { users, meta } = await aircall.listUsers({ page, perPage: 50 });
    total += users.length;
    for (const u of users) {
      const row = {
        aircallUserId: String(u.id),
        name: u.name,
        email: u.email ?? null,
        available: Boolean(u.available),
        doNotDisturb: Boolean(u.do_not_disturb),
        archived: Boolean(u.archived),
      };
      await prisma.aircallUserCache.upsert({
        where: { aircallUserId: row.aircallUserId },
        create: row,
        update: { ...row, syncedAt: new Date() },
      });
      upserted += 1;
    }
    if (!meta.next_page_link || users.length === 0) break;
    page += 1;
  }
  return { total, upserted, durationMs: Date.now() - start };
}
