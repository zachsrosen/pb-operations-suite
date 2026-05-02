import { NextRequest } from "next/server";

import type { StatsFilter } from "@/lib/aircall-stats";

const MAX_RANGE_DAYS = 365;

export interface ParsedFilter extends StatsFilter {
  page: number;
  pageSize: number;
  sort: "startedAt" | "durationSec" | "talkTimeSec";
  order: "asc" | "desc";
}

export function parseFilter(req: NextRequest): { filter: ParsedFilter } | { error: string } {
  const sp = req.nextUrl.searchParams;
  const fromStr = sp.get("from");
  const toStr = sp.get("to");

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = fromStr ? new Date(fromStr) : defaultFrom;
  const to = toStr ? new Date(toStr) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: "Invalid from/to" };
  if (from >= to) return { error: "from must be before to" };
  if ((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24) > MAX_RANGE_DAYS) {
    return { error: `Range exceeds ${MAX_RANGE_DAYS} days` };
  }

  const userIdsRaw = sp.get("userId");
  const userIds = userIdsRaw ? userIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const directionRaw = sp.get("direction");
  const direction = directionRaw === "inbound" || directionRaw === "outbound" ? directionRaw : undefined;

  const statusRaw = sp.get("status");
  const allowedStatus = new Set(["answered", "missed", "voicemail"] as const);
  const status = statusRaw
    ? (statusRaw
        .split(",")
        .map((s) => s.trim() as "answered" | "missed" | "voicemail")
        .filter((s) => allowedStatus.has(s)))
    : undefined;

  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("pageSize") ?? 50) || 50));

  const sortRaw = sp.get("sort");
  const sort: ParsedFilter["sort"] =
    sortRaw === "durationSec" || sortRaw === "talkTimeSec" ? sortRaw : "startedAt";
  const order: ParsedFilter["order"] = sp.get("order") === "asc" ? "asc" : "desc";

  return {
    filter: {
      from,
      to,
      userIds,
      direction,
      status,
      page,
      pageSize,
      sort,
      order,
    },
  };
}

export function isFlagEnabled(): boolean {
  return process.env.AIRCALL_DASHBOARD_ENABLED === "true";
}
