/**
 * Send retroactive survey reassignment emails for surveys that were
 * reassigned from Derek Pomar to Sam Paro before the notification
 * feature was deployed.
 *
 * Run:  npx tsx scripts/send-retroactive-reassignment-emails.ts
 * Preview only (no emails sent):  DRY_RUN=1 npx tsx scripts/send-retroactive-reassignment-emails.ts
 */
import "dotenv/config";
import { prisma, getCrewMemberByName, getCrewMemberByZuperUserUid } from "../src/lib/db";
import { sendReassignmentNotification } from "../src/lib/email";
import { getDealOwnerContact } from "../src/lib/hubspot";
import { zuper } from "../src/lib/zuper";
import { normalizeEmail } from "../src/lib/email-utils";

const DRY_RUN = !!process.env.DRY_RUN;
const TODAY = "2026-03-16";
const PREVIOUS_SURVEYOR_NAME = "Derek Pomar";
const NEW_SURVEYOR_NAME = "Samuel Paro";

function deriveCustomerDetails(projectName: string): {
  customerName: string;
  customerAddress: string;
} {
  const parts = projectName.split(" | ");
  const customerName =
    parts.length >= 2 ? parts[1]?.trim() : parts[0]?.trim() || "Customer";
  const customerAddress =
    parts.length >= 3
      ? parts[2]?.trim()
      : parts.length >= 2 && !parts[0].includes("PROJ-")
        ? parts[1]?.trim()
        : "See Zuper for address";
  return { customerName, customerAddress };
}

async function main() {
  if (!prisma) {
    console.error("❌ Database not configured (check DATABASE_URL)");
    process.exit(1);
  }

  console.log(
    DRY_RUN
      ? "\n🔍 DRY RUN — no emails will be sent\n"
      : "\n📧 LIVE RUN — emails will be sent\n"
  );

  // Resolve email for a surveyor using the full fallback chain:
  // CrewMember (by name) → App User (by name) → Zuper API (by UID from CrewMember) → env override
  async function resolveSurveyorEmail(name: string, envOverride?: string): Promise<string | null> {
    // 1. Env var override
    if (envOverride) {
      const override = normalizeEmail(envOverride);
      if (override) return override;
    }

    // 2. CrewMember by name
    const crew = await getCrewMemberByName(name);
    const crewEmail = normalizeEmail(crew?.email);
    if (crewEmail) return crewEmail;

    // 3. App User by name
    if (prisma) {
      const appUser = await prisma.user.findFirst({
        where: { name },
        select: { email: true },
      });
      const appEmail = normalizeEmail(appUser?.email);
      if (appEmail) return appEmail;
    }

    // 4. Zuper API by UID (if CrewMember has a zuperUserUid)
    if (crew?.zuperUserUid) {
      const result = await zuper.getUser(crew.zuperUserUid);
      if (result.type === "success") {
        const zuperEmail = normalizeEmail(result.data?.email);
        if (zuperEmail) return zuperEmail;
      }
    }

    return null;
  }

  // Look up email addresses
  const derekEmail = await resolveSurveyorEmail(
    PREVIOUS_SURVEYOR_NAME,
    process.env.PREVIOUS_SURVEYOR_EMAIL
  );
  const samEmail = await resolveSurveyorEmail(
    NEW_SURVEYOR_NAME,
    process.env.NEW_SURVEYOR_EMAIL
  );

  if (!derekEmail) {
    console.error(`❌ No email found for "${PREVIOUS_SURVEYOR_NAME}"`);
    console.error(`   Set PREVIOUS_SURVEYOR_EMAIL env var to override`);
    process.exit(1);
  }
  if (!samEmail) {
    console.error(`❌ No email found for "${NEW_SURVEYOR_NAME}"`);
    console.error(`   Set NEW_SURVEYOR_EMAIL env var to override`);
    process.exit(1);
  }

  console.log(`👤 ${PREVIOUS_SURVEYOR_NAME}: ${derekEmail}`);
  console.log(`👤 ${NEW_SURVEYOR_NAME}: ${samEmail}\n`);

  const startOfDay = new Date(`${TODAY}T00:00:00Z`);
  const endOfDay = new Date(`${TODAY}T23:59:59Z`);

  // ── Wide-net diagnostic: what does the DB actually have? ──

  // 1. ALL survey records touched today (any user, any status)
  const allToday = await prisma.scheduleRecord.findMany({
    where: {
      scheduleType: "survey",
      OR: [
        { updatedAt: { gte: startOfDay, lte: endOfDay } },
        { createdAt: { gte: startOfDay, lte: endOfDay } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`🔎 ALL survey records created or updated today: ${allToday.length}\n`);
  for (const r of allToday) {
    console.log(
      `   [${r.status}] assignedUser="${r.assignedUser}" | ${r.scheduledDate} | ${r.projectId}`
    );
    console.log(
      `     ${r.projectName}`
    );
    console.log(
      `     created=${r.createdAt.toISOString()} updated=${r.updatedAt.toISOString()}`
    );
  }
  console.log();

  // 2. ANY Derek survey records (any status, any date)
  const allDerek = await prisma.scheduleRecord.findMany({
    where: {
      scheduleType: "survey",
      assignedUser: { contains: "Derek", mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  console.log(`🔎 Most recent Derek survey records (any date/status): ${allDerek.length}\n`);
  for (const r of allDerek) {
    console.log(
      `   [${r.status}] assignedUser="${r.assignedUser}" | ${r.scheduledDate} | ${r.projectId}`
    );
    console.log(
      `     created=${r.createdAt.toISOString()} updated=${r.updatedAt.toISOString()}`
    );
  }
  console.log();

  // 3. ANY Sam survey records (any status, any date)
  const allSam = await prisma.scheduleRecord.findMany({
    where: {
      scheduleType: "survey",
      assignedUser: { contains: "Sam", mode: "insensitive" },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  console.log(`🔎 Most recent Sam survey records (any date/status): ${allSam.length}\n`);
  for (const r of allSam) {
    console.log(
      `   [${r.status}] assignedUser="${r.assignedUser}" | ${r.scheduledDate} | ${r.projectId}`
    );
    console.log(
      `     created=${r.createdAt.toISOString()} updated=${r.updatedAt.toISOString()}`
    );
  }
  console.log();

  // ── Now pair them up ──
  const derekProjectIds = new Set(allDerek.map((r) => r.projectId));
  const samToday = allToday.filter(
    (r) =>
      (r.assignedUser || "").toLowerCase().includes("sam") &&
      ["scheduled", "tentative"].includes(r.status)
  );
  const reassigned = samToday.filter((r) => derekProjectIds.has(r.projectId));

  // Also show Sam records that DON'T have a Derek counterpart
  console.log(`📋 Sam records created today with a Derek project match: ${reassigned.length}`);
  console.log(`📋 Sam records created today WITHOUT a Derek match: ${samToday.length - reassigned.length}\n`);

  if (reassigned.length === 0) {
    console.log("✅ No reassigned survey records matched. Review diagnostic output above.");
    process.exit(0);
  }

  console.log(
    `📋 Found ${reassigned.length} survey(s) reassigned from ${PREVIOUS_SURVEYOR_NAME} to ${NEW_SURVEYOR_NAME} today:\n`
  );

  let sent = 0;
  let errors = 0;

  for (const record of reassigned) {
    const { customerName, customerAddress } = deriveCustomerDetails(
      record.projectName
    );

    // Enrich with HubSpot deal owner
    let dealOwnerName: string | undefined;
    try {
      const owner = await getDealOwnerContact(record.projectId);
      dealOwnerName = owner.ownerName || undefined;
    } catch {
      // Non-critical — skip deal owner enrichment
    }

    const schedulerEmail =
      normalizeEmail(record.scheduledByEmail) ||
      normalizeEmail(record.scheduledBy) || // Salvage: older rows sometimes store email in scheduledBy
      "noreply@photonbrothers.com";
    // If scheduledBy was used as the email, fall back to a generic name
    const schedulerName =
      (record.scheduledBy && !record.scheduledBy.includes("@")
        ? record.scheduledBy
        : null) || "PB Operations";

    console.log(
      `  📄 ${record.projectName} | ${record.scheduledDate} ${record.scheduledStart || ""}–${record.scheduledEnd || ""}`
    );
    console.log(
      `     Reassigned by: ${schedulerName} (${schedulerEmail})`
    );

    if (DRY_RUN) {
      console.log(`     → Would send OUTGOING to ${derekEmail}`);
      console.log(`     → Would send INCOMING to ${samEmail}\n`);
      continue;
    }

    // Send outgoing email to Derek (previous surveyor)
    try {
      const outgoing = await sendReassignmentNotification({
        to: derekEmail,
        crewMemberName: PREVIOUS_SURVEYOR_NAME,
        reassignedByName: schedulerName,
        reassignedByEmail: schedulerEmail,
        otherSurveyorName: NEW_SURVEYOR_NAME,
        direction: "outgoing",
        customerName,
        customerAddress,
        scheduledDate: record.scheduledDate,
        scheduledStart: record.scheduledStart || undefined,
        scheduledEnd: record.scheduledEnd || undefined,
        projectId: record.projectId,
        zuperJobUid: record.zuperJobUid || undefined,
        dealOwnerName,
        notes: record.notes || undefined,
      });
      if (outgoing.success) {
        console.log(`     ✅ Outgoing to ${derekEmail}`);
        sent++;
      } else {
        console.log(`     ⚠️  Outgoing failed: ${outgoing.error}`);
        errors++;
      }
    } catch (err) {
      console.log(`     ❌ Outgoing error: ${err}`);
      errors++;
    }

    // Send incoming email to Sam (new surveyor)
    try {
      const incoming = await sendReassignmentNotification({
        to: samEmail,
        crewMemberName: NEW_SURVEYOR_NAME,
        reassignedByName: schedulerName,
        reassignedByEmail: schedulerEmail,
        otherSurveyorName: PREVIOUS_SURVEYOR_NAME,
        direction: "incoming",
        customerName,
        customerAddress,
        scheduledDate: record.scheduledDate,
        scheduledStart: record.scheduledStart || undefined,
        scheduledEnd: record.scheduledEnd || undefined,
        projectId: record.projectId,
        zuperJobUid: record.zuperJobUid || undefined,
        dealOwnerName,
        notes: record.notes || undefined,
      });
      if (incoming.success) {
        console.log(`     ✅ Incoming to ${samEmail}`);
        sent++;
      } else {
        console.log(`     ⚠️  Incoming failed: ${incoming.error}`);
        errors++;
      }
    } catch (err) {
      console.log(`     ❌ Incoming error: ${err}`);
      errors++;
    }

    console.log();
  }

  console.log(
    `\n📊 Done: ${sent} emails sent, ${errors} errors, ${reassigned.length} surveys processed\n`
  );
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
