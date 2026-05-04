/**
 * Aggregation helpers for the Call Analytics dashboard. All queries hit
 * AircallCallCache via Prisma — no in-memory loops over large result sets.
 */

import { prisma } from "@/lib/db";

export interface StatsFilter {
  from: Date;
  to: Date;
  userIds?: string[]; // aircallUserId multi-select
  direction?: "inbound" | "outbound";
  status?: Array<"answered" | "missed" | "voicemail">;
  provider?: string; // defaults to "aircall"
}

export interface CallKpis {
  total: number;
  inbound: number;
  outbound: number;
  missed: number;
  missedRate: number;
  voicemailRate: number;
  avgTimeToAnswerSec: number | null;
  totalTalkTimeSec: number;
  answerRate: number;
  deltaVsPrior: {
    total: number; // signed pct change (1.0 = +100%)
    missedRate: number; // absolute change in points (0..1 scale)
    avgTimeToAnswerSec: number; // absolute seconds delta
  };
}

export interface PerUserRow {
  aircallUserId: string;
  name: string;
  email: string | null;
  totalCalls: number;
  inbound: number;
  outbound: number;
  talkTimeSec: number;
  missed: number;
  /**
   * Inbound calls this user was rung for during the period (from
   * `call.ringing_on_agent` events). Null if no ring data exists for the
   * user in this window — typically pre-webhook-subscription history.
   */
  rangCount: number | null;
  /**
   * Of the rings, how many this user actually answered. Null when rangCount
   * is null. Intentionally inbound-only — outbound calls don't ring agents.
   */
  rangAnswered: number | null;
  /**
   * Per-user inbound answer rate computed as rangAnswered / rangCount.
   * Null when no ring data exists in the period.
   */
  answerRate: number | null;
  avgTimeToAnswerSec: number | null;
  avgDurationSec: number;
  lastActivityAt: string | null;
}

export interface PerDayRow {
  date: string; // YYYY-MM-DD UTC
  inbound: number;
  outbound: number;
  missed: number;
}

export interface HourHeatmapCell {
  dayOfWeek: number; // 1=Mon..7=Sun
  hour: number; // 0..23
  count: number;
}

function buildWhere(filter: StatsFilter) {
  const where: Record<string, unknown> = {
    provider: filter.provider ?? "aircall",
    startedAt: { gte: filter.from, lt: filter.to },
  };
  if (filter.direction) where.direction = filter.direction;
  if (filter.status && filter.status.length > 0) where.status = { in: filter.status };
  if (filter.userIds && filter.userIds.length > 0) where.userAircallId = { in: filter.userIds };
  return where;
}

async function basicCounts(filter: StatsFilter) {
  const where = buildWhere(filter);
  const grouped = await prisma.aircallCallCache.groupBy({
    by: ["direction", "status"],
    where,
    _count: { _all: true },
    _sum: { talkTimeSec: true, timeToAnswerSec: true },
  });
  let total = 0;
  let inbound = 0;
  let outbound = 0;
  let missed = 0;
  let voicemail = 0;
  let answered = 0;
  let totalTalkTimeSec = 0;
  let answerSum = 0;
  let answerN = 0;
  for (const g of grouped) {
    const n = g._count._all;
    total += n;
    if (g.direction === "inbound") inbound += n;
    if (g.direction === "outbound") outbound += n;
    if (g.status === "missed") missed += n;
    if (g.status === "voicemail") voicemail += n;
    if (g.status === "answered") {
      answered += n;
      if (g._sum.timeToAnswerSec) {
        answerSum += g._sum.timeToAnswerSec;
        answerN += n;
      }
    }
    totalTalkTimeSec += g._sum.talkTimeSec ?? 0;
  }
  return {
    total,
    inbound,
    outbound,
    missed,
    voicemail,
    answered,
    totalTalkTimeSec,
    avgTimeToAnswerSec: answerN > 0 ? answerSum / answerN : null,
  };
}

export async function getKpis(filter: StatsFilter): Promise<CallKpis> {
  const current = await basicCounts(filter);

  // Prior period of equal length for delta
  const lengthMs = filter.to.getTime() - filter.from.getTime();
  const prior = await basicCounts({
    ...filter,
    from: new Date(filter.from.getTime() - lengthMs),
    to: filter.from,
  });

  const missedRate = current.total > 0 ? current.missed / current.total : 0;
  const priorMissedRate = prior.total > 0 ? prior.missed / prior.total : 0;
  const totalDelta = prior.total > 0 ? (current.total - prior.total) / prior.total : 0;
  const avgTtaDelta = (current.avgTimeToAnswerSec ?? 0) - (prior.avgTimeToAnswerSec ?? 0);
  const answerRate = current.total > 0 ? current.answered / current.total : 0;
  const voicemailRate = current.total > 0 ? current.voicemail / current.total : 0;

  return {
    total: current.total,
    inbound: current.inbound,
    outbound: current.outbound,
    missed: current.missed,
    missedRate,
    voicemailRate,
    avgTimeToAnswerSec: current.avgTimeToAnswerSec,
    totalTalkTimeSec: current.totalTalkTimeSec,
    answerRate,
    deltaVsPrior: {
      total: totalDelta,
      missedRate: missedRate - priorMissedRate,
      avgTimeToAnswerSec: avgTtaDelta,
    },
  };
}

export async function getPerUser(filter: StatsFilter): Promise<PerUserRow[]> {
  const where = buildWhere(filter);
  const grouped = await prisma.aircallCallCache.groupBy({
    by: ["userAircallId", "userName", "userEmail", "direction", "status"],
    where,
    _count: { _all: true },
    _sum: { talkTimeSec: true, timeToAnswerSec: true, durationSec: true },
    _max: { startedAt: true },
  });

  type Acc = {
    name: string;
    email: string | null;
    inbound: number;
    outbound: number;
    missed: number;
    answered: number;
    voicemail: number;
    total: number;
    talkTimeSec: number;
    timeToAnswerSum: number;
    timeToAnswerN: number;
    durationSum: number;
    durationN: number;
    lastActivityAt: Date | null;
  };
  const byUser = new Map<string, Acc>();

  for (const g of grouped) {
    const key = g.userAircallId ?? "__unassigned";
    const cur =
      byUser.get(key) ??
      ({
        name: g.userName ?? (key === "__unassigned" ? "Unassigned" : "Unknown"),
        email: g.userEmail ?? null,
        inbound: 0,
        outbound: 0,
        missed: 0,
        answered: 0,
        voicemail: 0,
        total: 0,
        talkTimeSec: 0,
        timeToAnswerSum: 0,
        timeToAnswerN: 0,
        durationSum: 0,
        durationN: 0,
        lastActivityAt: null,
      } satisfies Acc);
    const n = g._count._all;
    cur.total += n;
    if (g.direction === "inbound") cur.inbound += n;
    if (g.direction === "outbound") cur.outbound += n;
    if (g.status === "missed") cur.missed += n;
    if (g.status === "answered") {
      cur.answered += n;
      if (g._sum.timeToAnswerSec) {
        cur.timeToAnswerSum += g._sum.timeToAnswerSec;
        cur.timeToAnswerN += n;
      }
    }
    if (g.status === "voicemail") cur.voicemail += n;
    cur.talkTimeSec += g._sum.talkTimeSec ?? 0;
    cur.durationSum += g._sum.durationSec ?? 0;
    cur.durationN += n;
    if (g._max.startedAt && (!cur.lastActivityAt || g._max.startedAt > cur.lastActivityAt)) {
      cur.lastActivityAt = g._max.startedAt;
    }
    byUser.set(key, cur);
  }

  // Pull ring counts per-user for the same window. This is the source of
  // truth for inbound answer rate — covers ring-group misses that have no
  // userAircallId on the call row itself.
  const ringRows = await prisma.aircallCallRing.groupBy({
    by: ["userAircallId"],
    where: {
      provider: filter.provider ?? "aircall",
      ringedAt: { gte: filter.from, lt: filter.to },
      ...(filter.userIds && filter.userIds.length > 0 ? { userAircallId: { in: filter.userIds } } : {}),
    },
    _count: { _all: true },
  });
  const ringAnsweredRows = await prisma.aircallCallRing.groupBy({
    by: ["userAircallId"],
    where: {
      provider: filter.provider ?? "aircall",
      ringedAt: { gte: filter.from, lt: filter.to },
      answeredAt: { not: null },
      ...(filter.userIds && filter.userIds.length > 0 ? { userAircallId: { in: filter.userIds } } : {}),
    },
    _count: { _all: true },
  });
  const rangByUser = new Map<string, number>();
  for (const r of ringRows) rangByUser.set(r.userAircallId, r._count._all);
  const ansByUser = new Map<string, number>();
  for (const r of ringAnsweredRows) ansByUser.set(r.userAircallId, r._count._all);

  // Direction filter — outbound rings don't exist (you're the caller), so
  // when the user filters to outbound only, ring-based answer rate is N/A.
  const outboundOnly = filter.direction === "outbound";

  const rows: PerUserRow[] = [];
  for (const [aircallUserId, v] of byUser) {
    const rang = aircallUserId !== "__unassigned" ? rangByUser.get(aircallUserId) ?? 0 : 0;
    const rangAns = aircallUserId !== "__unassigned" ? ansByUser.get(aircallUserId) ?? 0 : 0;
    const hasRingData = !outboundOnly && rang > 0 && aircallUserId !== "__unassigned";
    rows.push({
      aircallUserId: aircallUserId === "__unassigned" ? "" : aircallUserId,
      name: v.name,
      email: v.email,
      totalCalls: v.total,
      inbound: v.inbound,
      outbound: v.outbound,
      talkTimeSec: v.talkTimeSec,
      missed: v.missed,
      rangCount: hasRingData ? rang : null,
      rangAnswered: hasRingData ? rangAns : null,
      answerRate: hasRingData ? rangAns / rang : null,
      avgTimeToAnswerSec: v.timeToAnswerN > 0 ? Math.round(v.timeToAnswerSum / v.timeToAnswerN) : null,
      avgDurationSec: v.durationN > 0 ? Math.round(v.durationSum / v.durationN) : 0,
      lastActivityAt: v.lastActivityAt ? v.lastActivityAt.toISOString() : null,
    });
  }
  rows.sort((a, b) => b.totalCalls - a.totalCalls);
  return rows;
}

export async function getPerDay(filter: StatsFilter): Promise<PerDayRow[]> {
  // Use a raw query for efficient day bucketing in UTC. All filter clauses
  // are unconditionally present using `IS NULL OR ...` so positional params
  // never shift regardless of which filters are populated.
  const where = buildWhere(filter);
  const provider = (where.provider as string) ?? "aircall";

  type Row = { date: Date; direction: string; status: string; n: bigint };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT date_trunc('day', "startedAt" AT TIME ZONE 'UTC') as date,
            direction, status, COUNT(*)::bigint as n
       FROM "AircallCallCache"
       WHERE provider = $1 AND "startedAt" >= $2 AND "startedAt" < $3
         AND ($4::text[] IS NULL OR status = ANY($4::text[]))
         AND ($5::text[] IS NULL OR "userAircallId" = ANY($5::text[]))
         AND ($6::text IS NULL OR direction = $6)
       GROUP BY 1, 2, 3
       ORDER BY 1`,
    provider,
    filter.from,
    filter.to,
    filter.status && filter.status.length > 0 ? filter.status : null,
    filter.userIds && filter.userIds.length > 0 ? filter.userIds : null,
    filter.direction ?? null,
  )) as Row[];

  type Bucket = { date: string; inbound: number; outbound: number; missed: number };
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const dateStr = r.date.toISOString().slice(0, 10);
    const cur = map.get(dateStr) ?? { date: dateStr, inbound: 0, outbound: 0, missed: 0 };
    const n = Number(r.n);
    if (r.direction === "inbound") cur.inbound += n;
    if (r.direction === "outbound") cur.outbound += n;
    if (r.status === "missed") cur.missed += n;
    map.set(dateStr, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getHourHeatmap(filter: StatsFilter): Promise<HourHeatmapCell[]> {
  const where = buildWhere(filter);
  const provider = (where.provider as string) ?? "aircall";

  type Row = { dow: number; hour: number; n: bigint };
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT EXTRACT(ISODOW FROM "startedAt" AT TIME ZONE 'UTC')::int as dow,
            EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'UTC')::int as hour,
            COUNT(*)::bigint as n
       FROM "AircallCallCache"
       WHERE provider = $1 AND "startedAt" >= $2 AND "startedAt" < $3
         AND ($4::text[] IS NULL OR status = ANY($4::text[]))
         AND ($5::text[] IS NULL OR "userAircallId" = ANY($5::text[]))
         AND ($6::text IS NULL OR direction = $6)
       GROUP BY 1, 2`,
    provider,
    filter.from,
    filter.to,
    filter.status && filter.status.length > 0 ? filter.status : null,
    filter.userIds && filter.userIds.length > 0 ? filter.userIds : null,
    filter.direction ?? null,
  )) as Row[];

  return rows.map((r) => ({ dayOfWeek: r.dow, hour: r.hour, count: Number(r.n) }));
}
