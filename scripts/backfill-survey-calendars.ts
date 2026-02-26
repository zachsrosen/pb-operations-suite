import fs from "node:fs";
import path from "node:path";

type CliOptions = {
  dryRun: boolean;
  fromDate?: string;
  limit?: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg.startsWith("--from=")) {
      options.fromDate = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) options.limit = n;
      continue;
    }
  }
  return options;
}

function parseDotenvLine(rawLine: string): [string, string] | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;
  const idx = line.indexOf("=");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  let value = line.slice(idx + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  // Mirror dotenv behavior for escaped newlines used in private keys and some copied IDs.
  value = value.replace(/\\n/g, "\n");
  return [key, value];
}

function loadDotenvIfPresent(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const parsed = parseDotenvLine(rawLine);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function parseCustomerDetails(projectName: string): { customerName: string; customerAddress: string } {
  const parts = projectName.split(" | ");
  const customerName = parts.length >= 2 ? parts[1]?.trim() || "Customer" : parts[0]?.trim() || "Customer";
  const customerAddress = parts.length >= 3 ? parts[2]?.trim() || "See Zuper for address" : "See Zuper for address";
  return { customerName, customerAddress };
}

function normalizeEmail(input?: string | null): string | null {
  const value = (input || "").trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

function isUuidLike(value?: string | null): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isDeletedCalendarError(error?: string): boolean {
  const text = (error || "").toLowerCase();
  return text.includes(" 410 ") || text.includes("\"code\": 410") || text.includes("reason\": \"deleted\"");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  loadDotenvIfPresent(path.join(cwd, ".env.local"));
  loadDotenvIfPresent(path.join(cwd, ".env"));

  const db = await import("../src/lib/db");
  const { zuper } = await import("../src/lib/zuper");
  const calendar = await import("../src/lib/google-calendar");

  if (!db.prisma) {
    throw new Error("Database not configured (DATABASE_URL missing).");
  }

  const whereClause: Record<string, unknown> = {
    scheduleType: "survey",
    status: "scheduled",
  };
  if (options.fromDate) {
    whereClause.scheduledDate = { gte: options.fromDate };
  }

  const scheduled = await db.prisma.scheduleRecord.findMany({
    where: whereClause,
    select: {
      projectId: true,
      projectName: true,
      scheduledDate: true,
      scheduledStart: true,
      scheduledEnd: true,
      assignedUser: true,
      assignedUserUid: true,
      notes: true,
      zuperJobUid: true,
      updatedAt: true,
    },
    orderBy: [{ projectId: "asc" }, { updatedAt: "desc" }],
    ...(options.limit ? { take: options.limit * 4 } : {}),
  });

  const latestByProject = new Map<string, typeof scheduled[number]>();
  for (const row of scheduled) {
    if (!latestByProject.has(row.projectId)) {
      latestByProject.set(row.projectId, row);
    }
  }

  const projectIds = [...latestByProject.keys()];
  const historyRows = projectIds.length > 0
    ? await db.prisma.scheduleRecord.findMany({
      where: {
        scheduleType: "survey",
        projectId: { in: projectIds },
      },
      select: {
        projectId: true,
        assignedUser: true,
        assignedUserUid: true,
      },
    })
    : [];

  const historyByProject = new Map<string, Array<{ assignedUser: string | null; assignedUserUid: string | null }>>();
  for (const row of historyRows) {
    const arr = historyByProject.get(row.projectId) || [];
    arr.push({ assignedUser: row.assignedUser, assignedUserUid: row.assignedUserUid });
    historyByProject.set(row.projectId, arr);
  }

  const byUidCache = new Map<string, string | null>();
  const byNameCache = new Map<string, string | null>();
  const zuperUserCache = new Map<string, string | null>();

  const resolveEmailFromIdentity = async (params: { assignedUser?: string | null; assignedUserUid?: string | null }): Promise<string | null> => {
    const uid = (params.assignedUserUid || "").split(",").map((v) => v.trim()).find((v) => isUuidLike(v));
    if (uid) {
      if (!byUidCache.has(uid)) {
        const byUid = await db.getCrewMemberByZuperUserUid(uid);
        byUidCache.set(uid, normalizeEmail(byUid?.email) || null);
      }
      const fromCrew = byUidCache.get(uid) || null;
      if (fromCrew) return fromCrew;

      if (!zuperUserCache.has(uid)) {
        const userResult = await zuper.getUser(uid);
        const email = userResult.type === "success" ? normalizeEmail(userResult.data?.email) : null;
        zuperUserCache.set(uid, email || null);
      }
      const fromZuperUser = zuperUserCache.get(uid) || null;
      if (fromZuperUser) return fromZuperUser;
    }

    const name = (params.assignedUser || "").trim();
    if (name) {
      if (!byNameCache.has(name)) {
        const byName = await db.getCrewMemberByName(name);
        let email = normalizeEmail(byName?.email);
        if (!email && db.prisma) {
          const appUser = await db.prisma.user.findFirst({
            where: { name },
            select: { email: true },
          });
          email = normalizeEmail(appUser?.email);
        }
        byNameCache.set(name, email || null);
      }
      return byNameCache.get(name) || null;
    }
    return null;
  };

  const resolveCurrentAssignee = async (
    row: typeof scheduled[number]
  ): Promise<{ email: string | null; name: string | null }> => {
    const fallbackName = (row.assignedUser || "").trim() || null;
    if (row.zuperJobUid) {
      const jobResult = await zuper.getJob(row.zuperJobUid);
      if (jobResult.type === "success" && jobResult.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assignedUser = (jobResult.data as any)?.assigned_to?.[0]?.user;
        const assignedName =
          [assignedUser?.first_name, assignedUser?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || fallbackName;
        const directEmail = normalizeEmail(assignedUser?.email);
        if (directEmail) return { email: directEmail, name: assignedName };
        const fromJobIdentity = await resolveEmailFromIdentity({
          assignedUser: [assignedUser?.first_name, assignedUser?.last_name].filter(Boolean).join(" ").trim() || null,
          assignedUserUid: assignedUser?.user_uid || null,
        });
        if (fromJobIdentity) return { email: fromJobIdentity, name: assignedName };
      }
    }
    const fallbackEmail = await resolveEmailFromIdentity({
      assignedUser: row.assignedUser,
      assignedUserUid: row.assignedUserUid,
    });
    return { email: fallbackEmail, name: fallbackName };
  };

  const allRecords = [...latestByProject.values()];
  const targetRecords = options.limit ? allRecords.slice(0, options.limit) : allRecords;

  console.log(
    `[backfill-survey-calendars] Processing ${targetRecords.length} scheduled survey project(s)` +
    `${options.dryRun ? " (dry-run)" : ""}`
  );

  let syncedPersonal = 0;
  let syncedShared = 0;
  let deletedStalePersonal = 0;
  let deletedStaleShared = 0;
  let skippedNoAssigneeEmail = 0;
  let failures = 0;

  const nickSharedCalendar = calendar.getSiteSurveySharedCalendarIdForSurveyor("nick.scarpellino@photonbrothers.com");
  const denverSharedCalendar = calendar.getDenverSiteSurveyCalendarId();
  const knownSharedCalendars = [...new Set([nickSharedCalendar, denverSharedCalendar].filter(Boolean) as string[])];

  for (const row of targetRecords) {
    const target = await resolveCurrentAssignee(row);
    const targetEmail = target.email;
    const targetSurveyorName = target.name;
    if (!targetEmail) {
      skippedNoAssigneeEmail += 1;
      console.warn(`[backfill-survey-calendars] Skip ${row.projectId}: no assignee email resolved`);
      continue;
    }

    const { customerName, customerAddress } = parseCustomerDetails(row.projectName);
    const targetSharedCalendarId = calendar.getSiteSurveySharedCalendarIdForSurveyor(targetEmail);

    const historicalEmails = new Set<string>();
    for (const hist of historyByProject.get(row.projectId) || []) {
      const email = await resolveEmailFromIdentity({
        assignedUser: hist.assignedUser,
        assignedUserUid: hist.assignedUserUid,
      });
      if (email && email !== targetEmail) historicalEmails.add(email);
    }

    if (options.dryRun) {
      console.log(
        `[dry-run] ${row.projectId} ${row.scheduledDate} target=${targetEmail}` +
        `${targetSharedCalendarId ? ` shared=${targetSharedCalendarId}` : ""}` +
        `${historicalEmails.size ? ` stalePersonal=${[...historicalEmails].join(",")}` : ""}`
      );
      continue;
    }

    try {
      const personal = await calendar.upsertSiteSurveyCalendarEvent({
        surveyorEmail: targetEmail,
        surveyorName: targetSurveyorName || undefined,
        projectId: row.projectId,
        projectName: row.projectName,
        customerName,
        customerAddress,
        date: row.scheduledDate,
        startTime: row.scheduledStart || undefined,
        endTime: row.scheduledEnd || undefined,
        notes: row.notes || undefined,
        zuperJobUid: row.zuperJobUid || undefined,
        calendarId: "primary",
        impersonateEmail: targetEmail,
      });
      if (personal.success) {
        syncedPersonal += 1;
      } else {
        failures += 1;
        console.warn(`[backfill-survey-calendars] Personal sync failed for ${row.projectId}: ${personal.error}`);
      }

      if (targetSharedCalendarId) {
        const shared = await calendar.upsertSiteSurveyCalendarEvent({
          surveyorEmail: targetEmail,
          surveyorName: targetSurveyorName || undefined,
          projectId: row.projectId,
          projectName: row.projectName,
          customerName,
          customerAddress,
          date: row.scheduledDate,
          startTime: row.scheduledStart || undefined,
          endTime: row.scheduledEnd || undefined,
          notes: row.notes || undefined,
          zuperJobUid: row.zuperJobUid || undefined,
          calendarId: targetSharedCalendarId,
          impersonateEmail: calendar.getSiteSurveySharedCalendarImpersonationEmail(targetEmail) || targetEmail,
        });
        if (shared.success) {
          syncedShared += 1;
        } else {
          failures += 1;
          console.warn(`[backfill-survey-calendars] Shared sync failed for ${row.projectId}: ${shared.error}`);
        }
      }

      for (const staleEmail of historicalEmails) {
        const del = await calendar.deleteSiteSurveyCalendarEvent({
          projectId: row.projectId,
          surveyorEmail: staleEmail,
          calendarId: "primary",
          impersonateEmail: staleEmail,
        });
        if (del.success || isDeletedCalendarError(del.error)) {
          deletedStalePersonal += 1;
        } else {
          failures += 1;
          console.warn(`[backfill-survey-calendars] Stale personal delete failed for ${row.projectId} (${staleEmail}): ${del.error}`);
        }
      }

      for (const sharedCalendarId of knownSharedCalendars) {
        if (sharedCalendarId === targetSharedCalendarId) continue;
        const del = await calendar.deleteSiteSurveyCalendarEvent({
          projectId: row.projectId,
          surveyorEmail: targetEmail,
          calendarId: sharedCalendarId,
          impersonateEmail: calendar.getSiteSurveySharedCalendarImpersonationEmail(targetEmail) || undefined,
        });
        if (del.success || isDeletedCalendarError(del.error)) {
          deletedStaleShared += 1;
        } else {
          failures += 1;
          console.warn(`[backfill-survey-calendars] Stale shared delete failed for ${row.projectId} (${sharedCalendarId}): ${del.error}`);
        }
      }
    } catch (err) {
      failures += 1;
      console.warn(
        `[backfill-survey-calendars] Unexpected error for ${row.projectId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log(
    `[backfill-survey-calendars] Done. personal_upserts=${syncedPersonal}, shared_upserts=${syncedShared},` +
    ` stale_personal_deletes=${deletedStalePersonal}, stale_shared_deletes=${deletedStaleShared},` +
    ` skipped_no_assignee_email=${skippedNoAssigneeEmail}, failures=${failures}`
  );

  await db.prisma.$disconnect();
}

main().catch((error) => {
  console.error("[backfill-survey-calendars] Fatal:", error);
  process.exitCode = 1;
});
