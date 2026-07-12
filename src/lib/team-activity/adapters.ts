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
import {
  denverDay,
  isTouchOnActiveDeal,
  ptoDaysFromOooEvents,
  TERMINAL_STAGE_LABELS,
  type ActivityEvent,
  type PtoDaysByEmail,
  type TalkTimeRecord,
} from "./metrics";
import { buildEmailIndex, matchRosterByDisplayName, memberEmails, type RosterMember } from "./roster";

export interface DateRange {
  from: Date;
  to: Date;
}
export interface AdapterResult {
  events: ActivityEvent[];
  talk?: TalkTimeRecord[];
  skipped?: string;
  /** Source ran but with degraded coverage (e.g. search cap hit, engagement pull failed). */
  warning?: string;
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
// Zuper — ExternalActivity (job status changes by employee, populated by the
// zuper-field-activity-sync cron). Replaces the old schedule-date-only version.
// ---------------------------------------------------------------------------
export async function zuperAdapter(
  prisma: PrismaClient,
  range: DateRange,
  roster: RosterMember[],
): Promise<AdapterResult> {
  const index = buildEmailIndex(roster);
  const emails = [...index.keys()];
  try {
    const rows = await prisma.externalActivity.findMany({
      where: { source: "zuper", userEmail: { in: emails, mode: "insensitive" }, occurredAt: { gte: range.from, lte: range.to } },
      select: { userEmail: true, occurredAt: true, kind: true, label: true, dealId: true },
    });
    const events: ActivityEvent[] = [];
    for (const r of rows) {
      const email = index.get(lc(r.userEmail));
      if (!email) continue;
      events.push({
        email,
        timestamp: r.occurredAt,
        source: "zuper",
        kind: r.kind,
        label: r.label ?? undefined,
        objectKey: r.dealId ? `DEAL:${r.dealId}` : undefined,
      });
    }
    return { events };
  } catch (e) {
    // ExternalActivity table not migrated yet (or read failed) — degrade cleanly.
    return { events: [], skipped: `Zuper field activity unavailable (needs migration + sync): ${msg(e)}` };
  }
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
async function hsFetch(path: string, token: string, init?: RequestInit, retries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (res.status === 429 && i < retries) {
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
      continue;
    }
    return res;
  }
}

async function hsGet(path: string, token: string): Promise<Response> {
  return hsFetch(path, token);
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

// ---------------------------------------------------------------------------
// Deals-touched: engagement pull + active-deal stamping
// (see docs/superpowers/specs/2026-07-10-team-activity-deals-touched-design.md)
// ---------------------------------------------------------------------------
const ENGAGEMENT_TYPES = ["notes", "calls", "emails", "meetings", "tasks", "communications"] as const;
type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
const SEARCH_CAP = 9_800; // CRM search hard-stops at 10k results per query
const OWNER_CHUNK = 5; // owners per search — keeps each query's volume under the cap

interface HsOwner { id: number | string; email?: string }

/** Resolve roster members -> HubSpot OWNER id (engagements filter on this, not userId). */
async function hsResolveOwnerIds(roster: RosterMember[], token: string): Promise<Map<string, string>> {
  const resolved = new Map<string, string>(); // canonical email -> ownerId
  await mapPool(roster, 5, async (m) => {
    for (const email of memberEmails(m)) {
      const res = await hsFetch(`/crm/v3/owners?email=${encodeURIComponent(email)}`, token);
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: HsOwner[] };
      const id = data.results?.[0]?.id;
      if (id != null) {
        resolved.set(m.email.toLowerCase(), String(id));
        return;
      }
    }
  });
  return resolved;
}

interface EngagementHit { id: string; ownerId: string; ts: Date; type: EngagementType }

/** Search one engagement type for all owners (chunked); ascending hs_timestamp. */
async function searchEngagements(
  type: EngagementType,
  ownerIds: string[],
  range: DateRange,
  token: string,
): Promise<{ hits: EngagementHit[]; capped: boolean }> {
  const hits: EngagementHit[] = [];
  let capped = false;
  for (let i = 0; i < ownerIds.length; i += OWNER_CHUNK) {
    const chunk = ownerIds.slice(i, i + OWNER_CHUNK);
    let after: string | undefined;
    let got = 0;
    for (;;) {
      const res = await hsFetch(`/crm/v3/objects/${type}/search`, token, {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: "hubspot_owner_id", operator: "IN", values: chunk },
                {
                  propertyName: "hs_timestamp",
                  operator: "BETWEEN",
                  value: String(range.from.getTime()),
                  highValue: String(range.to.getTime()),
                },
              ],
            },
          ],
          properties: ["hubspot_owner_id", "hs_timestamp"],
          sorts: [{ propertyName: "hs_timestamp", direction: "ASCENDING" }],
          limit: 100,
          ...(after ? { after } : {}),
        }),
      });
      if (!res.ok) throw new Error(`${type} search HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = (await res.json()) as HsPage<{ id: string; properties?: Record<string, string> }>;
      for (const r of data.results ?? []) {
        const ownerId = r.properties?.hubspot_owner_id;
        const ts = new Date(r.properties?.hs_timestamp ?? NaN);
        if (!ownerId || isNaN(+ts)) continue;
        hits.push({ id: r.id, ownerId, ts, type });
        got++;
      }
      const next = data.paging?.next?.after;
      if (!next) break;
      if (got >= SEARCH_CAP) {
        capped = true;
        break;
      }
      after = next;
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  return { hits, capped };
}

/** v4 batch association read, chunked at 100. Returns fromId -> toIds. */
async function batchAssocRead(
  fromType: string,
  toType: string,
  ids: string[],
  token: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const res = await hsFetch(`/crm/v4/associations/${fromType}/${toType}/batch/read`, token, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
    });
    if (!res.ok) throw new Error(`${fromType}->${toType} assoc HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as {
      results?: { from: { id: string | number }; to?: { toObjectId: string | number }[] }[];
    };
    for (const r of data.results ?? []) {
      const key = String(r.from.id);
      map.set(key, [...(map.get(key) ?? []), ...(r.to ?? []).map((t) => String(t.toObjectId))]);
    }
  }
  return map;
}

interface DealStatus { stageLabel: string; pipelineLabel: string; enteredTerminalAt: Date | null }

/**
 * Stage + (for terminal stages) entered-date for each deal. Deals the batch
 * read doesn't return (deleted/archived) are absent from the map — the caller
 * excludes their touches from both counts.
 */
async function fetchDealStatuses(dealIds: string[], token: string): Promise<Map<string, DealStatus>> {
  const out = new Map<string, DealStatus>();
  if (!dealIds.length) return out;

  const pipesRes = await hsFetch("/crm/v3/pipelines/deals", token);
  if (!pipesRes.ok) throw new Error(`pipelines HTTP ${pipesRes.status}`);
  const pipes = (await pipesRes.json()) as { results?: { label: string; stages: { id: string; label: string }[] }[] };
  const stageMeta = new Map<string, { label: string; pipeline: string }>();
  for (const p of pipes.results ?? []) {
    for (const s of p.stages) stageMeta.set(String(s.id), { label: s.label, pipeline: p.label });
  }

  const stageByDeal = new Map<string, string>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const chunk = dealIds.slice(i, i + 100);
    const res = await hsFetch("/crm/v3/objects/deals/batch/read", token, {
      method: "POST",
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: ["dealstage"] }),
    });
    if (!res.ok) throw new Error(`deals batch read HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as { results?: { id: string | number; properties?: Record<string, string> }[] };
    for (const r of data.results ?? []) {
      if (r.properties?.dealstage) stageByDeal.set(String(r.id), r.properties.dealstage);
    }
  }

  // Terminal-stage deals need hs_v2_date_entered_<stageId> (the un-prefixed
  // hs_date_entered_* props do NOT exist in PB's portal).
  const terminal: { id: string; stageId: string }[] = [];
  for (const [id, stageId] of stageByDeal) {
    const meta = stageMeta.get(stageId);
    if (meta && TERMINAL_STAGE_LABELS.has(meta.label.trim().toLowerCase())) terminal.push({ id, stageId });
  }
  const enteredByDeal = new Map<string, Date>();
  if (terminal.length) {
    const props = [...new Set(terminal.map((t) => `hs_v2_date_entered_${t.stageId}`))];
    for (let i = 0; i < terminal.length; i += 100) {
      const chunk = terminal.slice(i, i + 100);
      const res = await hsFetch("/crm/v3/objects/deals/batch/read", token, {
        method: "POST",
        body: JSON.stringify({ inputs: chunk.map((t) => ({ id: t.id })), properties: ["dealstage", ...props] }),
      });
      if (!res.ok) throw new Error(`entered-date batch read HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { id: string | number; properties?: Record<string, string> }[] };
      for (const r of data.results ?? []) {
        const entered = r.properties?.[`hs_v2_date_entered_${r.properties?.dealstage}`];
        if (entered) enteredByDeal.set(String(r.id), new Date(entered));
      }
    }
  }

  for (const [id, stageId] of stageByDeal) {
    const meta = stageMeta.get(stageId);
    if (!meta) continue;
    out.set(id, { stageLabel: meta.label, pipelineLabel: meta.pipeline, enteredTerminalAt: enteredByDeal.get(id) ?? null });
  }
  return out;
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

  // --- deals-touched: engagement pull + active-deal stamping ---------------
  // Failure here degrades to a warning: audit/login events still render, only
  // the deals-touched numbers are missing/floored.
  let warning: string | undefined;
  try {
    const ownerIds = await hsResolveOwnerIds(roster, token);
    const emailByOwner = new Map([...ownerIds.entries()].map(([email, id]) => [id, email] as const));
    const ownerList = [...new Set(ownerIds.values())];
    // A portal-wide owners failure must not silently floor the metric to
    // audit-only — surface it.
    if (roster.length && !ownerList.length) {
      warning = "no roster members resolved to a HubSpot owner — deals-touched reflects audit-log edits only";
    }

    const engagementTouches: { hit: EngagementHit; dealIds: string[] }[] = [];
    if (ownerList.length) {
      const capped: string[] = [];
      const failed: string[] = [];
      // Per-type catch: one failing engagement type (e.g. a missing scope)
      // degrades that type only, not the whole metric.
      const perType = await mapPool([...ENGAGEMENT_TYPES], 3, async (type) => {
        try {
          const { hits, capped: hitCap } = await searchEngagements(type, ownerList, range, token);
          if (hitCap) capped.push(type);
          return { type, hits };
        } catch (e) {
          failed.push(`${type} (${msg(e).slice(0, 80)})`);
          return { type, hits: [] as EngagementHit[] };
        }
      });
      const notes = [
        ...(capped.length ? [`search cap hit for ${capped.join(", ")}`] : []),
        ...(failed.length ? [`search failed for ${failed.join("; ")}`] : []),
      ];
      if (notes.length) warning = `engagement pull degraded: ${notes.join("; ")} — deal counts are floor values`;

      for (const { type, hits } of perType) {
        if (!hits.length) continue;
        const dealAssoc = await batchAssocRead(type, "deals", hits.map((h) => h.id), token);
        const orphans = hits.filter((h) => !(dealAssoc.get(h.id) ?? []).length);
        let contactAssoc = new Map<string, string[]>();
        let contactDeals = new Map<string, string[]>();
        if (orphans.length) {
          contactAssoc = await batchAssocRead(type, "contacts", orphans.map((h) => h.id), token);
          const contactIds = [...new Set([...contactAssoc.values()].flat())];
          if (contactIds.length) contactDeals = await batchAssocRead("contacts", "deals", contactIds, token);
        }
        for (const hit of hits) {
          let dealIds = dealAssoc.get(hit.id) ?? [];
          if (!dealIds.length) {
            dealIds = [...new Set((contactAssoc.get(hit.id) ?? []).flatMap((c) => contactDeals.get(c) ?? []))];
          }
          if (dealIds.length) engagementTouches.push({ hit, dealIds });
          // No deal even via contacts -> noise (notification emails) or
          // non-deal work; dropped per spec.
        }
      }
    }

    // Distinct deals from engagements + already-emitted audit DEAL rows.
    // Numeric ids only — audit rows can yield "DEAL:undefined", and one
    // malformed id 400s the whole batch read.
    const allDealIds = new Set<string>(engagementTouches.flatMap((t) => t.dealIds).filter((id) => /^\d+$/.test(id)));
    for (const ev of events) {
      const id = ev.objectKey?.startsWith("DEAL:") ? ev.objectKey.slice(5) : null;
      if (id && /^\d+$/.test(id)) allDealIds.add(id);
    }
    const statuses = await fetchDealStatuses([...allDealIds], token);
    const verdict = (dealId: string, ts: Date): boolean | null => {
      const st = statuses.get(dealId);
      if (!st) return null; // unreadable deal — exclude from both counts
      return isTouchOnActiveDeal(st.stageLabel, st.pipelineLabel, st.enteredTerminalAt, ts);
    };

    // Emit ONE event per engagement, with all attributed deals on it.
    for (const { hit, dealIds } of engagementTouches) {
      const email = emailByOwner.get(hit.ownerId);
      if (!email) continue; // engagement owned by a non-roster owner in the chunk
      const deals = dealIds
        .map((id) => ({ id, active: verdict(id, hit.ts) }))
        .filter((d): d is { id: string; active: boolean } => d.active !== null);
      events.push({
        email,
        timestamp: hit.ts,
        source: "hubspot",
        kind: `engagement/${hit.type}`,
        objectKey: deals[0] ? `DEAL:${deals[0].id}` : undefined,
        deals: deals.length ? deals : undefined,
      });
    }

    // Stamp the audit-log DEAL edits so they feed the same counts.
    for (const ev of events) {
      if (ev.deals || !ev.objectKey?.startsWith("DEAL:")) continue;
      const id = ev.objectKey.slice(5);
      const v = verdict(id, ev.timestamp);
      if (v !== null) ev.deals = [{ id, active: v }];
    }
  } catch (e) {
    warning = `engagement pull failed (${msg(e)}) — deals-touched unavailable for this run`;
  }

  return { events, warning };
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

  /**
   * OAuth integrations that act AS a user on Drive around the clock (verified
   * 2026-07-11 via Admin Reports drive+token logs — AWS IPs, mass
   * move/rename/ACL churn under patrick@). Their events are machine traffic,
   * not human activity, and are dropped from the google source. Keys are the
   * Google Cloud project numbers the drive audit log reports as
   * `originating_app_id`.
   */
  const INTEGRATION_APP_IDS = new Set([
    "654020450961", // Zuper GDrive Integration (job attachments -> Drive; AWS ap-south-1)
    "766098389391", // Read AI (meeting recordings/notes -> Drive)
    "346384273333", // Tray.ai - Drive connector (Caleb's Tray workflows)
    "344106271962", // PE Worklist Automation
  ]);

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
          if (app === "drive") {
            const originApp = paramOf(ev, "originating_app_id");
            if (originApp && INTEGRATION_APP_IDS.has(originApp)) continue; // machine traffic
          }
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

// ---------------------------------------------------------------------------
// PTO days. Primary source: the shared HR-fed "PTO calendar for Photon
// Brothers" (an @import.calendar.google.com ICS feed) — one read covers the
// whole company, including people who never set a Gmail OOO. That calendar is
// PRIVATE TO ITS SUBSCRIBERS: only the configured reader account can see it
// (others 404), so the read impersonates PTO_CALENDAR_READER. Fallback when
// the shared calendar is unreadable: each member's primary-calendar OOO
// blocks (the original source). calendar.events scope is already
// DWD-delegated for scheduling sync.
// ---------------------------------------------------------------------------
export interface PtoAdapterResult {
  pto: PtoDaysByEmail;
  skipped?: string;
}

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/** The YYYY-MM-DD after `day` (steps via UTC noon to avoid tz roll). */
const dayAfter = (day: string) =>
  new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** Add every YYYY-MM-DD in [startDay, endDayExclusive) to `out` (all-day OOO). */
function addAllDaySpan(out: Set<string>, startDay: string, endDayExclusive: string) {
  // All-day dates are calendar-local already; step via UTC noon to avoid tz roll.
  for (
    let t = new Date(`${startDay}T12:00:00Z`).getTime();
    ;
    t += 86_400_000
  ) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day >= endDayExclusive) break;
    out.add(day);
  }
}

async function perMemberOooPto(range: DateRange, roster: RosterMember[]): Promise<PtoAdapterResult> {
  interface GcalTime { date?: string; dateTime?: string }
  interface GcalEvent { start?: GcalTime; end?: GcalTime; status?: string }

  let authError: string | null = null;
  let anyOk = false;
  const pto: PtoDaysByEmail = new Map();

  await mapPool(roster, 5, async (m) => {
    const email = m.email.toLowerCase();
    try {
      const token = await getServiceAccountToken([CALENDAR_SCOPE], m.email);
      const qs = new URLSearchParams({
        eventTypes: "outOfOffice",
        singleEvents: "true",
        timeMin: range.from.toISOString(),
        timeMax: range.to.toISOString(),
        maxResults: "250",
      });
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          authError = `Google Calendar API ${res.status} — ${CALENDAR_SCOPE} not authorized for impersonation`;
        }
        return;
      }
      anyOk = true;
      const data = (await res.json()) as { items?: GcalEvent[] };
      const days = new Set<string>();
      const timedSpans: { start: Date; end: Date }[] = [];
      // Clamp to the report range so a months-long leave doesn't count PTO
      // days outside it (day strings compare lexicographically).
      const firstDay = denverDay(range.from);
      const rangeEndEx = dayAfter(denverDay(range.to));
      for (const ev of data.items ?? []) {
        if (ev.status === "cancelled") continue;
        if (ev.start?.date && ev.end?.date) {
          const startDay = ev.start.date > firstDay ? ev.start.date : firstDay;
          const endDayEx = ev.end.date < rangeEndEx ? ev.end.date : rangeEndEx;
          addAllDaySpan(days, startDay, endDayEx);
        } else if (ev.start?.dateTime && ev.end?.dateTime) {
          // Clamp to the report range so a months-long OOO doesn't expand past it.
          const start = new Date(Math.max(+new Date(ev.start.dateTime), +range.from));
          const end = new Date(Math.min(+new Date(ev.end.dateTime), +range.to));
          if (start < end) timedSpans.push({ start, end });
        }
      }
      for (const d of ptoDaysFromOooEvents(timedSpans)) days.add(d);
      if (days.size) pto.set(email, days);
    } catch (e) {
      authError = `Google Calendar token failed for ${email}: ${msg(e)}`;
    }
  });

  if (!anyOk && authError) return { pto, skipped: authError };
  return { pto };
}

// Calendar id is not a secret (useless without ACL); env overrides for testing.
const PTO_CALENDAR_ID =
  process.env.PTO_CALENDAR_ID ?? "6k6rc71rh6oa3q8hlj6chvo5rcpc1c71@import.calendar.google.com";
const PTO_CALENDAR_READER = process.env.PTO_CALENDAR_READER ?? "zach@photonbrothers.com";

/** "Kaitlyn Martinez on Vacation" / "Kat Arnoldi is Out of Office" -> name. */
export function parsePtoSummary(summary: string): string | null {
  const m = /^(.+?)\s+(?:on vacation|is out of office)\s*$/i.exec(summary);
  return m ? m[1].trim() : null;
}

export async function googlePtoAdapter(range: DateRange, roster: RosterMember[]): Promise<PtoAdapterResult> {
  interface GcalTime { date?: string; dateTime?: string }
  interface GcalEvent { summary?: string; start?: GcalTime; end?: GcalTime; status?: string }

  let token: string;
  try {
    token = await getServiceAccountToken([CALENDAR_SCOPE], PTO_CALENDAR_READER);
  } catch {
    return perMemberOooPto(range, roster); // reader impersonation failed — fall back
  }

  const firstDay = denverDay(range.from);
  const rangeEndEx = dayAfter(denverDay(range.to));
  const pto: PtoDaysByEmail = new Map();
  // Collect per-person spans first so the >=6h threshold applies across
  // multiple partial-day blocks on the same day.
  const allDayByEmail = new Map<string, Set<string>>();
  const timedByEmail = new Map<string, { start: Date; end: Date }[]>();

  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({
      singleEvents: "true",
      timeMin: range.from.toISOString(),
      timeMax: range.to.toISOString(),
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(PTO_CALENDAR_ID)}/events?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      // 404 = reader not subscribed / calendar gone; any failure -> fallback.
      return perMemberOooPto(range, roster);
    }
    const data = (await res.json()) as { items?: GcalEvent[]; nextPageToken?: string };
    for (const ev of data.items ?? []) {
      if (ev.status === "cancelled" || !ev.summary) continue;
      const name = parsePtoSummary(ev.summary);
      if (!name) continue;
      const email = matchRosterByDisplayName(roster, name);
      if (!email) continue; // not a roster member (or ambiguous)
      if (ev.start?.date && ev.end?.date) {
        const days = allDayByEmail.get(email) ?? allDayByEmail.set(email, new Set()).get(email)!;
        const startDay = ev.start.date > firstDay ? ev.start.date : firstDay;
        const endDayEx = ev.end.date < rangeEndEx ? ev.end.date : rangeEndEx;
        addAllDaySpan(days, startDay, endDayEx);
      } else if (ev.start?.dateTime && ev.end?.dateTime) {
        const start = new Date(Math.max(+new Date(ev.start.dateTime), +range.from));
        const end = new Date(Math.min(+new Date(ev.end.dateTime), +range.to));
        if (start < end) {
          (timedByEmail.get(email) ?? timedByEmail.set(email, []).get(email)!).push({ start, end });
        }
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  for (const [email, days] of allDayByEmail) pto.set(email, days);
  for (const [email, spans] of timedByEmail) {
    const days = pto.get(email) ?? new Set<string>();
    for (const d of ptoDaysFromOooEvents(spans)) days.add(d);
    if (days.size) pto.set(email, days);
  }
  return { pto };
}
