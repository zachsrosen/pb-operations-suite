// Push on-call assignments into a per-pool shared Google Calendar via the
// service account's domain-wide delegation. Each pool (California, Colorado)
// gets its own calendar, named "Photon Brothers — On-Call ({pool})". Events
// are created with the assigned electrician as an attendee so the shift lands
// on their primary calendar with notifications.
//
// Auth: reuses GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
// + GOOGLE_ADMIN_EMAIL (DWD impersonation). Same setup the Drive/Mail
// integrations already rely on.

import crypto from "node:crypto";
import { prisma } from "./db";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_API = "https://www.googleapis.com/calendar/v3";
// Use the events-only scope to match the rest of the codebase (Workspace DWD
// config grants .events to the service account, not full .calendar). This
// means we can read/write/delete events on existing calendars but cannot
// auto-create new calendars; admins create the per-pool calendars manually
// in Google Calendar and paste the ID into OnCallPool.googleCalendarId.
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

function isEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
      (process.env.GOOGLE_ADMIN_EMAIL || process.env.GMAIL_SENDER_EMAIL),
  );
}

function impersonateEmail(): string {
  return (process.env.GOOGLE_ADMIN_EMAIL ?? process.env.GMAIL_SENDER_EMAIL) as string;
}

// Mirrors parseServiceAccountPrivateKey in src/lib/google-calendar.ts.
// Handles both raw PEM (with literal \n) and base64-encoded JSON-style keys.
function parsePrivateKey(raw: string): string {
  const normalizedRaw = raw.replace(/\\n/g, "\n").trim();
  if (normalizedRaw.includes("-----BEGIN")) return normalizedRaw;
  const decoded = Buffer.from(raw, "base64").toString("utf-8");
  const normalizedDecoded = decoded.replace(/\\n/g, "\n").trim();
  if (normalizedDecoded.includes("-----BEGIN")) return normalizedDecoded;
  throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY does not contain a valid PEM key");
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getToken(): Promise<string> {
  if (!isEnabled()) throw new Error("Google service account credentials not configured");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    sub: impersonateEmail(),
    scope: SCOPES.join(" "),
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  sign.end();
  const sig = sign
    .sign(parsePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!), "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${header}.${payload}.${sig}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Google token error: ${data.error ?? "unknown"} — ${data.error_description ?? ""}`);
  }
  return data.access_token;
}

// Stable, lowercase iCalUID derived from the assignmentId so repeat publishes
// upsert rather than duplicate. Google requires [a-v0-9]{5,1024}.
export function eventIdFor(assignmentId: string): string {
  const hash = crypto.createHash("sha1").update(`oncall:${assignmentId}`).digest("hex").slice(0, 30);
  return `pboncall${hash}`;
}

// Sun=0..Sat=6
function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWeekend(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

function dateAddDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

type PoolForCalendar = {
  id: string;
  name: string;
  region: string;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  weekendShiftStart: string;
  weekendShiftEnd: string;
  googleCalendarId: string | null;
};

/**
 * Returns the calendarId for the pool. Requires that an admin has manually
 * created the calendar in Google Calendar, shared it with the @photonbrothers.com
 * domain (or with the service account directly with "Make changes to events"
 * permission), and pasted the calendar ID into OnCallPool.googleCalendarId.
 *
 * We can't auto-create calendars because the Workspace DWD config grants only
 * the calendar.events scope — calendars.insert requires the broader calendar
 * scope which isn't authorized for this service account.
 */
export async function ensureCalendarForPool(pool: PoolForCalendar): Promise<string> {
  if (pool.googleCalendarId) return pool.googleCalendarId;
  throw new Error(
    `Pool "${pool.name}" has no googleCalendarId set. ` +
      `Manually create a calendar in Google Calendar, share it with the service account ` +
      `(${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "<sa-email>"}) with "Make changes to events" permission, ` +
      `and update OnCallPool.googleCalendarId on this row.`,
  );
}

type AssignmentForCalendar = {
  id: string;
  date: string;
  poolId: string;
  crewMember: { name: string; email: string | null };
};

function shiftWindowFor(pool: PoolForCalendar, date: string) {
  const weekend = isWeekend(date);
  return {
    start: weekend ? pool.weekendShiftStart : pool.shiftStart,
    end: weekend ? pool.weekendShiftEnd : pool.shiftEnd,
  };
}

function toIsoLocal(date: string, time: string): string {
  // YYYY-MM-DDTHH:MM:00 — Calendar API uses tz separately
  const [h, m] = time.split(":");
  return `${date}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`;
}

export type UpsertOptions = {
  /**
   * Add the assigned electrician as an event attendee so the shift appears
   * on their primary calendar. Defaults true. Pass false during pre-go-live
   * staging to create events on the shared calendar without inviting anyone;
   * the same events can be flipped to invited later via a second pass with
   * inviteAttendee=true (event ids are stable so the second pass updates the
   * existing events in place).
   */
  inviteAttendee?: boolean;
};

/**
 * Upsert one event for a single assignment (one day). Events use weekday
 * shift hours Mon-Fri and weekend hours Sat/Sun. The crew member is added
 * as an attendee (unless options.inviteAttendee=false) so the event appears
 * on their primary calendar with notifications. Idempotent via stable event
 * ID derived from assignment id.
 */
export async function upsertAssignmentEvent(
  pool: PoolForCalendar,
  assignment: AssignmentForCalendar,
  options: UpsertOptions = {},
): Promise<void> {
  if (!isEnabled()) return;
  const calendarId = await ensureCalendarForPool(pool);
  const token = await getToken();
  const eventId = eventIdFor(assignment.id);
  const window = shiftWindowFor(pool, assignment.date);
  const crossesMidnight = window.end < window.start;
  const endDate = crossesMidnight ? dateAddDays(assignment.date, 1) : assignment.date;

  const inviteAttendee = options.inviteAttendee ?? true;

  const body = {
    id: eventId,
    summary: `On-Call: ${assignment.crewMember.name}`,
    description: `${pool.name} on-call rotation. Source: PB Tech Ops Suite.`,
    start: { dateTime: toIsoLocal(assignment.date, window.start), timeZone: pool.timezone },
    end: { dateTime: toIsoLocal(endDate, window.end), timeZone: pool.timezone },
    attendees: inviteAttendee && assignment.crewMember.email
      ? [{ email: assignment.crewMember.email, responseStatus: "accepted" as const }]
      : [],
    transparency: "opaque",
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 60 },
        { method: "popup", minutes: 15 },
      ],
    },
    extendedProperties: {
      private: {
        pbOnCallAssignmentId: assignment.id,
        pbOnCallPoolId: pool.id,
      },
    },
  };

  // PUT (update) by stable id; if 404, fall back to insert.
  const putRes = await fetch(
    `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=externalOnly&supportsAttachments=false`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (putRes.ok) return;
  if (putRes.status === 404 || putRes.status === 410) {
    // Insert path
    const insRes = await fetch(
      `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=externalOnly`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!insRes.ok) {
      throw new Error(`Calendar event insert failed: ${insRes.status} ${await insRes.text()}`);
    }
    return;
  }
  throw new Error(`Calendar event upsert failed: ${putRes.status} ${await putRes.text()}`);
}

/**
 * Delete an event for a given assignment. Used when an assignment is
 * reassigned via swap or PTO — the new assignment gets its own upsert,
 * and the old one (if its assignment row is being deleted, not just
 * mutated) is removed from the calendar.
 */
export async function deleteAssignmentEvent(pool: PoolForCalendar, assignmentId: string): Promise<void> {
  if (!isEnabled() || !pool.googleCalendarId) return;
  const token = await getToken();
  const eventId = eventIdFor(assignmentId);
  await fetch(
    `${CAL_API}/calendars/${encodeURIComponent(pool.googleCalendarId)}/events/${eventId}?sendUpdates=externalOnly`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  ).catch(() => {
    // Non-fatal — admin can clean up stale events manually.
  });
}

/**
 * Bulk-sync all assignments in a date range for a pool. Used after Publish
 * to push every newly-generated/updated assignment to Google Calendar.
 * Errors per-assignment are logged but don't abort the batch.
 *
 * Pass options.inviteAttendee=false to create events on the shared calendar
 * without adding the electrician as attendee — useful for staging the
 * schedule before announcing it.
 */
export async function syncRangeForPool(
  pool: PoolForCalendar,
  fromDate: string,
  toDate: string,
  options: UpsertOptions = {},
): Promise<{ synced: number; failed: number }> {
  if (!isEnabled()) return { synced: 0, failed: 0 };

  const assignments = await prisma.onCallAssignment.findMany({
    where: { poolId: pool.id, date: { gte: fromDate, lte: toDate } },
    include: { crewMember: { select: { name: true, email: true } } },
    orderBy: { date: "asc" },
  });

  let synced = 0;
  let failed = 0;
  for (const a of assignments) {
    try {
      await upsertAssignmentEvent(
        pool,
        {
          id: a.id,
          date: a.date,
          poolId: a.poolId,
          crewMember: a.crewMember,
        },
        options,
      );
      synced++;
    } catch (err) {
      failed++;
      console.warn("[on-call/gcal] failed to sync assignment", a.id, err);
    }
  }
  return { synced, failed };
}
