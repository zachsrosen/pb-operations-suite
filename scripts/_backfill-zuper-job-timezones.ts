/**
 * One-time backfill: stamp `job_timezone` on scheduled Zuper jobs that are
 * missing it. Jobs created through the Ops Suite never set the field, so
 * Zuper renders their times (UI + customer notifications) in the account
 * timezone (Mountain) — wrong for California customers.
 *
 * Timezone is derived from the job's customer_address.state:
 *   CA/California → America/Los_Angeles, everything else → America/Denver.
 *
 * The scheduled datetimes are re-sent VERBATIM (UTC, straight from the GET
 * response, no Date parsing) so the appointment instant cannot move. On the
 * first applied job the script re-fetches and verifies the stored times did
 * not shift; if they did, it reverts that job and aborts.
 *
 * CAUTION: Zuper may send the customer a "rescheduled" notification for each
 * updated job (times unchanged, but now rendered in the right timezone).
 * Prefer running with a near-term --days window to limit blast radius.
 *
 * Dry-run (default):
 *     npx tsx scripts/_backfill-zuper-job-timezones.ts
 *     npx tsx scripts/_backfill-zuper-job-timezones.ts --days 30
 *
 * Apply:
 *     npx tsx scripts/_backfill-zuper-job-timezones.ts --apply
 *     npx tsx scripts/_backfill-zuper-job-timezones.ts --apply --limit 5
 */
import "dotenv/config";
import { zuperTimezoneForState } from "../src/lib/zuper";

const API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const API_KEY = process.env.ZUPER_API_KEY;

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.indexOf("--days");
const WINDOW_DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 120;
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

type ListedJob = {
  job_uid: string;
  work_order_number?: number;
  job_title?: string;
  job_timezone?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  scheduled_duration?: number | null;
  customer_address?: { state?: string; city?: string } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zuperFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY!,
      ...init?.headers,
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Zuper HTTP ${res.status} for ${path}: ${text.slice(0, 300)}`);
  }
  return data;
}

/** "2026-07-13T16:00:00.000Z" → "2026-07-13 16:00:00" (verbatim UTC, no Date math). */
function isoToZuperDateTime(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (!m) throw new Error(`Unexpected datetime format from Zuper: ${iso}`);
  return `${m[1]} ${m[2]}`;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function listScheduledJobs(): Promise<ListedJob[]> {
  const from = fmtDate(new Date());
  const to = fmtDate(new Date(Date.now() + WINDOW_DAYS * 24 * 60 * 60 * 1000));
  const jobs: ListedJob[] = [];
  const count = 100;
  for (let page = 1; page <= 50; page++) {
    const res = await zuperFetch(
      `/jobs?page=${page}&count=${count}&filter.from_date=${from}&filter.to_date=${to}`
    );
    const batch: ListedJob[] = Array.isArray(res?.data) ? res.data : [];
    jobs.push(...batch);
    if (batch.length < count) break;
  }
  return jobs;
}

async function getJobTimes(
  jobUid: string
): Promise<{ start: string | null; end: string | null; tz: string | null }> {
  const res = await zuperFetch(`/jobs/${jobUid}`);
  const j = res?.data || {};
  return {
    start: j.scheduled_start_time ?? null,
    end: j.scheduled_end_time ?? null,
    tz: j.job_timezone ?? null,
  };
}

async function putSchedule(job: ListedJob, timezone: string | null): Promise<void> {
  await zuperFetch(`/jobs/schedule`, {
    method: "PUT",
    body: JSON.stringify({
      job_uid: job.job_uid,
      from_date: isoToZuperDateTime(job.scheduled_start_time!),
      to_date: isoToZuperDateTime(job.scheduled_end_time!),
      ...(timezone && { job_timezone: timezone }),
    }),
  });
}

async function main() {
  if (!API_KEY) {
    console.error("ZUPER_API_KEY is not set");
    process.exit(1);
  }

  console.log(
    `Scanning scheduled jobs from today through +${WINDOW_DAYS} days (${APPLY ? "APPLY" : "dry-run"})…`
  );
  const jobs = await listScheduledJobs();
  console.log(`Fetched ${jobs.length} jobs in window.`);

  const now = Date.now();
  const candidates = jobs.filter((j) => {
    if (j.job_timezone) return false; // already stamped
    if (!j.scheduled_start_time || !j.scheduled_end_time) return false;
    // Skip the zero-length "cleared schedule" sentinel.
    if (j.scheduled_start_time === j.scheduled_end_time) return false;
    // Only future appointments — past jobs can't confuse anyone anymore.
    if (new Date(j.scheduled_start_time).getTime() < now) return false;
    return true;
  });

  const skippedNoAddress = candidates.filter((j) => !j.customer_address?.state);
  const targets = candidates
    .filter((j) => j.customer_address?.state)
    .map((j) => ({ job: j, timezone: zuperTimezoneForState(j.customer_address!.state) }));

  console.log(`\n${targets.length} jobs missing job_timezone:`);
  for (const { job, timezone } of targets) {
    console.log(
      `  #${job.work_order_number} ${timezone.padEnd(19)} ${job.scheduled_start_time} | ${(job.job_title || "").slice(0, 70)}`
    );
  }
  if (skippedNoAddress.length) {
    console.log(`\nSkipped (no customer address state): ${skippedNoAddress.length}`);
    for (const j of skippedNoAddress) {
      console.log(`  #${j.work_order_number} ${(j.job_title || "").slice(0, 70)}`);
    }
  }

  if (!APPLY) {
    console.log(`\nDry run complete. Re-run with --apply to stamp ${targets.length} jobs.`);
    return;
  }

  let applied = 0;
  for (const [i, { job, timezone }] of targets.entries()) {
    if (applied >= LIMIT) {
      console.log(`--limit ${LIMIT} reached, stopping.`);
      break;
    }
    const before = { start: job.scheduled_start_time!, end: job.scheduled_end_time! };
    await putSchedule(job, timezone);
    applied++;

    if (i === 0) {
      // Verification gate: make sure job_timezone is a display tag and the
      // stored UTC instant did not move. Abort (and revert) if it shifted.
      const after = await getJobTimes(job.job_uid);
      if (after.start !== before.start || after.end !== before.end) {
        console.error(
          `\nABORT: times shifted on verification job #${job.work_order_number}!` +
            `\n  before: ${before.start} → ${before.end}` +
            `\n  after:  ${after.start} → ${after.end}` +
            `\nZuper appears to interpret from_date/to_date in job_timezone. Reverting…`
        );
        await putSchedule(
          { ...job, scheduled_start_time: before.start, scheduled_end_time: before.end },
          null
        );
        process.exit(3);
      }
      if (after.tz !== timezone) {
        console.error(
          `\nABORT: job_timezone did not stick on #${job.work_order_number} (got ${after.tz}).`
        );
        process.exit(3);
      }
      console.log(`Verification job #${job.work_order_number} OK — times unchanged, tz=${after.tz}.`);
    } else {
      console.log(`Stamped #${job.work_order_number} → ${timezone}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nDone. Stamped ${applied}/${targets.length} jobs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
