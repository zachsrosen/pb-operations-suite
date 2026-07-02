/**
 * Source adapters for the team-activity report.
 *
 * Each adapter turns one system into the normalized shape the metrics engine
 * expects: `{ events, talk?, skipped? }`. DB adapters (pbops/aircall/zuper) read
 * our Neon DB and always run. hubspot/google reach external APIs and DEGRADE
 * GRACEFULLY: on a missing-scope / permission error they return `skipped` with a
 * one-line reason and no events, so the report is produced from whatever
 * succeeded. When the scope is later granted, the same code starts returning
 * data with no changes.
 */

import type { PrismaClient } from "../../generated/prisma/client";
import { getServiceAccountToken } from "../google-auth";
import { denverDay, type ActivityEvent, type TalkTimeRecord } from "./metrics";
import { buildEmailIndex, memberEmails, type RosterMember } from "./roster";

export interface DateRange {
  from: Date;
  to: Date;
}
export interface AdapterResult {
  events: ActivityEvent[];
  talk?: TalkTimeRecord[];
  skipped?: string;
}

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run `fn` over `items` with at most `limit` in flight. Used to fan out the
 * per-person HubSpot/Google API pulls (the dominant cost) instead of looping
 * one person at a time, while keeping concurrency low enough to respect rate
 * limits. Results preserve input order.
 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// PB Tech Ops — ActivityLog (our DB, always available)
// ---------------------------------------------------------------------------
export async function pbopsAdapter(
  prisma: PrismaClient,
  range: DateRange,
  roster: RosterMember[],
): Promise<AdapterResult> {
  const index = buildEmailIndex(roster);
  const emails = [...index.keys()];
  const rows = await prisma.activityLog.findMany({
    where: { userEmail: { in: emails, mode: "insensitive" }, createdAt: { gte: range.from, lte: range.to } },
    select: { userEmail: true, type: true, entityType: true, entityId: true, createdAt: true, description: true, entityName: true },
  });
  const events: ActivityEvent[] = [];
  for (const r of rows) {
    const email = index.get(lc(r.userEmail));
    if (!email) continue;
    events.push({
      email,
      timestamp: r.createdAt,
      source: "pbops",
      objectKey: r.entityType && r.entityId ? `${r.entityType}:${r.entityId}` : undefined,
      kind: r.type,
      label: r.description || r.entityName || undefined,
    });
  }
  return { events };
}

// ---------------------------------------------------------------------------
// Aircall — AircallCallCache (our DB; real talk-minutes)
// ---------------------------------------------------------------------------
export async function aircallAdapter(
  prisma: PrismaClient,
  range: DateRange,
  roster: RosterMember[],
): Promise<AdapterResult> {
  const index = buildEmailIndex(roster);
  const emails = [...index.keys()];
  const aircallIds = roster.map((m) => m.aircallId).filter((x): x is string => !!x);
  const rows = await prisma.aircallCallCache.findMany({
    where: {
      startedAt: { gte: range.from, lte: range.to },
      OR: [
        { userEmail: { in: emails, mode: "insensitive" } },
        ...(aircallIds.length ? [{ userAircallId: { in: aircallIds } }] : []),
      ],
    },
    select: { id: true, userEmail: true, userAircallId: true, startedAt: true, talkTimeSec: true, direction: true, status: true },
  });
  const idToEmail = new Map<string, string>();
  for (const m of roster) if (m.aircallId) idToEmail.set(m.aircallId, m.email.toLowerCase());

  const events: ActivityEvent[] = [];
  const talkMap = new Map<string, TalkTimeRecord>();
  for (const r of rows) {
    const email = index.get(lc(r.userEmail)) ?? (r.userAircallId ? idToEmail.get(r.userAircallId) : undefined);
    if (!email) continue;
    events.push({ email, timestamp: r.startedAt, source: "aircall", kind: `${r.direction} ${r.status}`, objectKey: `call:${r.id}` });
    const day = denverDay(r.startedAt);
    const key = `${email} ${day}`;
    const t = talkMap.get(key) ?? { email, day, talkSec: 0, calls: 0 };
    t.talkSec += r.talkTimeSec ?? 0;
    t.calls += 1;
    talkMap.set(key, t);
  }
  return { events, talk: [...talkMap.values()] };
}

// ---------------------------------------------------------------------------
// Zuper — ZuperJobCache (our DB; LOW SIGNAL: schedule/complete dates only)
// ---------------------------------------------------------------------------
export async function zuperAdapter(
  prisma: PrismaClient,
  range: DateRange,
  roster: RosterMember[],
): Promise<AdapterResult> {
  const names = roster
    .map((m) => ({ email: m.email.toLowerCase(), name: (m.zuperName ?? m.name).toLowerCase() }))
    .filter((m) => m.name);
  const rows = await prisma.zuperJobCache.findMany({
    where: {
      OR: [
        { completedDate: { gte: range.from, lte: range.to } },
        { scheduledStart: { gte: range.from, lte: range.to } },
      ],
    },
    select: { assignedUsers: true, completedDate: true, scheduledStart: true, jobUid: true },
  });
  const events: ActivityEvent[] = [];
  for (const r of rows) {
    const assigned = Array.isArray(r.assignedUsers) ? (r.assignedUsers as Array<{ user_name?: string }>) : [];
    const assignedNames = assigned.map((a) => lc(a.user_name)).filter(Boolean);
    for (const m of names) {
      if (!assignedNames.some((n) => n.includes(m.name) || m.name.includes(n))) continue;
      const stamps: Array<[Date | null, string]> = [
        [r.completedDate, "job_completed"],
        [r.scheduledStart, "job_scheduled"],
      ];
      for (const [ts, kind] of stamps) {
        if (ts && ts >= range.from && ts <= range.to) {
          events.push({ email: m.email, timestamp: ts, source: "zuper", objectKey: `job:${r.jobUid}`, kind });
        }
      }
    }
  }
  return { events };
}

// ---------------------------------------------------------------------------
// Participate Energy — PeDocVersion (our DB; who uploaded which PE doc when)
// ---------------------------------------------------------------------------
export async function peAdapter(
  prisma: PrismaClient,
  range: DateRange,
  roster: RosterMember[],
): Promise<AdapterResult> {
  const index = buildEmailIndex(roster);
  const emails = [...index.keys()];
  const rows = await prisma.peDocVersion.findMany({
    where: { uploadedAt: { gte: range.from, lte: range.to }, uploadedBy: { in: emails, mode: "insensitive" } },
    select: { uploadedBy: true, uploadedAt: true, docName: true, version: true, dealId: true, peProjectId: true },
  });
  const events: ActivityEvent[] = [];
  for (const r of rows) {
    const email = index.get(lc(r.uploadedBy));
    if (!email) continue;
    events.push({
      email,
      timestamp: r.uploadedAt,
      source: "pe",
      kind: `uploaded ${r.docName} v${r.version}`,
      objectKey: r.dealId ? `DEAL:${r.dealId}` : `pe:${r.peProjectId}`,
    });
  }
  return { events };
}

// ---------------------------------------------------------------------------
// HubSpot — account-info activity API (scope: account-info.security.read)
// ---------------------------------------------------------------------------
async function hsGet(path: string, token: string): Promise<Response> {
  return fetch(`https://api.hubapi.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

interface HsPage<T> {
  results?: T[];
  paging?: { next?: { after?: string } };
}
async function hsPageAll<T>(base: string, params: Record<string, string>, token: string, cap = 20_000): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (;;) {
    const qs = new URLSearchParams({ ...params, ...(after ? { after } : {}) });
    const res = await hsGet(`${base}?${qs}`, token);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as HsPage<T>;
    const results = data.results ?? [];
    out.push(...results);
    const next = data.paging?.next?.after;
    if (!next || !results.length || out.length >= cap) break;
    after = next;
    await new Promise((r) => setTimeout(r, 40));
  }
  return out;
}

interface HsUser { id: number | string; email?: string }
interface HsAudit { occurredAt: string; category?: string; subCategory?: string; action?: string; targetObjectId?: string }
interface HsLogin { loginAt: string; loginSucceeded?: boolean }

/** Resolve roster members -> HubSpot userId via the users directory (paginated). */
async function hsResolveUserIds(roster: RosterMember[], token: string): Promise<Map<string, string>> {
  const wanted = new Map<string, string>(); // any-known-email -> canonical
  for (const m of roster) for (const e of memberEmails(m)) wanted.set(e, m.email.toLowerCase());
  const resolved = new Map<string, string>(); // canonical email -> userId
  // seed from roster fast-path
  for (const m of roster) if (m.hubspotUserId) resolved.set(m.email.toLowerCase(), m.hubspotUserId);

  const users = await hsPageAll<HsUser>("/settings/v3/users", { limit: "100" }, token);
  for (const u of users) {
    const canonical = wanted.get(lc(u.email));
    if (canonical && !resolved.has(canonical)) resolved.set(canonical, String(u.id));
  }
  return resolved;
}

export async function hubspotAdapter(range: DateRange, roster: RosterMember[]): Promise<AdapterResult> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return { events: [], skipped: "HUBSPOT_ACCESS_TOKEN not set" };
  const occurredAfter = range.from.toISOString();

  let userIds: Map<string, string>;
  try {
    userIds = await hsResolveUserIds(roster, token);
  } catch (e) {
    return { events: [], skipped: `HubSpot user directory failed: ${msg(e)}` };
  }
  if (!userIds.size) return { events: [], skipped: "no roster members resolved to a HubSpot user" };

  // Fan out per-member pulls (each paginates audit-logs + login) with a small
  // concurrency cap — this is the dominant cost of the whole report.
  let scopeError: string | null = null;
  const perMember = await mapPool([...userIds.entries()], 5, async ([email, uid]) => {
    const evs: ActivityEvent[] = [];
    try {
      // Audit log — filter param is actingUserId (userId is silently ignored).
      const audits = await hsPageAll<HsAudit>(
        "/account-info/v3/activity/audit-logs",
        { actingUserId: uid, occurredAfter, limit: "100" },
        token,
      );
      for (const a of audits) {
        const ts = new Date(a.occurredAt);
        if (ts < range.from || ts > range.to) continue;
        evs.push({
          email,
          timestamp: ts,
          source: "hubspot",
          objectKey: `${a.subCategory}:${a.targetObjectId}`,
          kind: `${a.category}/${a.action}`,
        });
      }
      // Login history — filter param is userId here.
      const logins = await hsPageAll<HsLogin>("/account-info/v3/activity/login", { userId: uid, limit: "100" }, token);
      for (const l of logins) {
        if (!l.loginSucceeded) continue;
        const ts = new Date(l.loginAt);
        if (ts < range.from || ts > range.to) continue;
        evs.push({ email, timestamp: ts, source: "hubspot", kind: "login" });
      }
    } catch (e) {
      // A scope/permission error is systemic (not per-member) — record it.
      if (/\b40[13]\b/.test(msg(e))) scopeError = `HubSpot scope/permission error (needs account-info.security.read): ${msg(e)}`;
      // otherwise skip just this member
    }
    return evs;
  });
  const events = perMember.flat();
  if (scopeError && events.length === 0) return { events, skipped: scopeError };
  return { events };
}

// ---------------------------------------------------------------------------
// Google Workspace — Admin SDK Reports API (scope: admin.reports.audit.readonly)
// Not yet granted; attempts and degrades gracefully until IT adds the scope.
// ---------------------------------------------------------------------------
export async function googleAdapter(
  range: DateRange,
  roster: RosterMember[],
  adminSubject = process.env.GOOGLE_REPORTS_ADMIN_EMAIL,
): Promise<AdapterResult> {
  const scope = "https://www.googleapis.com/auth/admin.reports.audit.readonly";
  let token: string;
  try {
    // Reports API must be called as an admin; impersonate one.
    token = await getServiceAccountToken([scope], adminSubject);
  } catch (e) {
    return { events: [], skipped: `Google Reports scope not delegated (${msg(e)}); add ${scope} to DWD` };
  }
  interface ReportParam { name?: string; value?: string; multiValue?: string[] }
  interface ReportEvent { name?: string; parameters?: ReportParam[] }
  interface ReportItem { id?: { time?: string }; events?: ReportEvent[] }
  const paramOf = (ev: ReportEvent | undefined, name: string) => {
    const p = ev?.parameters?.find((x) => x.name === name);
    return p?.value ?? p?.multiValue?.[0];
  };
  // Applications to pull per user. login = day boundaries; drive = real work
  // (docs/sheets edits); meet/chat = calls + messages.
  const APPS = ["login", "drive", "meet", "chat"] as const;
  const PAGE_CAP = 5; // up to 5k events per (user, app) — guards runaway Drive volume

  let authError: string | null = null;
  const tasks = roster.flatMap((m) => APPS.map((app) => ({ m, app })));
  const perTask = await mapPool(tasks, 5, async ({ m, app }) => {
    const evs: ActivityEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < PAGE_CAP; page++) {
      const url =
        `https://admin.googleapis.com/admin/reports/v1/activity/users/${encodeURIComponent(m.email)}` +
        `/applications/${app}?startTime=${range.from.toISOString()}&endTime=${range.to.toISOString()}` +
        `&maxResults=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) authError = `Google Reports API ${res.status} — scope/admin not authorized`;
          return evs;
        }
        const data = (await res.json()) as { items?: ReportItem[]; nextPageToken?: string };
        for (const item of data.items ?? []) {
          const ts = new Date(item.id?.time ?? NaN);
          if (isNaN(+ts) || ts < range.from || ts > range.to) continue;
          const ev = item.events?.[0];
          const name = ev?.name;
          const docTitle = app === "drive" ? paramOf(ev, "doc_title") : undefined;
          const docId = app === "drive" ? paramOf(ev, "doc_id") : undefined;
          evs.push({
            email: m.email.toLowerCase(),
            timestamp: ts,
            source: "google",
            kind: name ? `${app} ${name}` : app,
            objectKey: docId ? `gdoc:${docId}` : undefined,
            label: docTitle || undefined,
          });
        }
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      } catch {
        break; // skip this app for this member
      }
    }
    return evs;
  });
  const events = perTask.flat();
  if (authError && events.length === 0) return { events, skipped: authError };
  return { events };
}
