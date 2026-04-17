import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";

export const runtime = "nodejs";

type LinkableSourceName = "hubspot" | "zuper" | "zoho";

type SourceCountMap = Record<LinkableSourceName, number>;

interface ActivityMetricWindow {
  totalEvents: number;
  confirmLinks: number;
  confirmLinksBySource: SourceCountMap;
  createSourceLinks: number;
  createSourceLinksBySource: SourceCountMap;
  createInternalWithLinks: number;
  mergeInternal: number;
}

function isAllowedRole(role: UserRole): boolean {
  return role === "ADMIN" || role === "EXECUTIVE";
}

function buildZeroSourceCounts(): SourceCountMap {
  return {
    hubspot: 0,
    zuper: 0,
    zoho: 0,
  };
}

function buildEmptyWindow(): ActivityMetricWindow {
  return {
    totalEvents: 0,
    confirmLinks: 0,
    confirmLinksBySource: buildZeroSourceCounts(),
    createSourceLinks: 0,
    createSourceLinksBySource: buildZeroSourceCounts(),
    createInternalWithLinks: 0,
    mergeInternal: 0,
  };
}

function toPercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSource(value: unknown): LinkableSourceName | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hubspot") return "hubspot";
  if (normalized === "zuper") return "zuper";
  if (normalized === "zoho") return "zoho";
  return null;
}

function readSources(value: unknown): LinkableSourceName[] {
  if (Array.isArray(value)) {
    const sources: LinkableSourceName[] = [];
    for (const entry of value) {
      const direct = normalizeSource(entry);
      if (direct) {
        sources.push(direct);
        continue;
      }
      if (isRecord(entry)) {
        const nested = normalizeSource(entry.source);
        if (nested) sources.push(nested);
      }
    }
    return [...new Set(sources)];
  }

  const single = normalizeSource(value);
  return single ? [single] : [];
}

function applyActivityEvent(window: ActivityMetricWindow, metadata: unknown): void {
  const meta = isRecord(metadata) ? metadata : {};
  const action = String(meta.action || "").trim();
  window.totalEvents += 1;

  if (action === "confirm_link") {
    window.confirmLinks += 1;
    const changedSources = readSources(meta.changedSources);
    for (const source of changedSources) {
      window.confirmLinksBySource[source] += 1;
    }
    return;
  }

  if (action === "create_source_link") {
    window.createSourceLinks += 1;
    const source = normalizeSource(meta.source);
    if (source) {
      window.createSourceLinksBySource[source] += 1;
    }
    return;
  }

  if (action === "create_internal_with_links") {
    window.createInternalWithLinks += 1;
    return;
  }

  if (action === "merge_internal") {
    window.mergeInternal += 1;
  }
}

function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function GET() {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.role ?? authResult.role) as UserRole)]?.normalizesTo ?? ((dbUser?.role ?? authResult.role) as UserRole));
  if (!isAllowedRole(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const now = new Date();
  const last7dStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30dStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalActiveSkus,
    linkedHubspot,
    linkedZuper,
    linkedZoho,
    fullyLinkedAll,
    activityRows,
    lastActivity,
    catalogGroupCounts,
  ] = await Promise.all([
    prisma.internalProduct.count({
      where: { isActive: true },
    }),
    prisma.internalProduct.count({
      where: {
        isActive: true,
        hubspotProductId: { not: null },
        NOT: { hubspotProductId: "" },
      },
    }),
    prisma.internalProduct.count({
      where: {
        isActive: true,
        zuperItemId: { not: null },
        NOT: { zuperItemId: "" },
      },
    }),
    prisma.internalProduct.count({
      where: {
        isActive: true,
        zohoItemId: { not: null },
        NOT: { zohoItemId: "" },
      },
    }),
    prisma.internalProduct.count({
      where: {
        isActive: true,
        hubspotProductId: { not: null },
        zuperItemId: { not: null },
        zohoItemId: { not: null },
        NOT: [
          { hubspotProductId: "" },
          { zuperItemId: "" },
          { zohoItemId: "" },
        ],
      },
    }),
    prisma.activityLog.findMany({
      where: {
        type: "FEATURE_USED",
        entityType: "product_comparison",
        createdAt: { gte: last30dStart },
      },
      select: {
        createdAt: true,
        metadata: true,
      },
    }),
    prisma.activityLog.findFirst({
      where: {
        type: "FEATURE_USED",
        entityType: "product_comparison",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.catalogProduct.groupBy({
      by: ["source"],
      _count: { _all: true },
    }),
  ]);

  const activity7d = buildEmptyWindow();
  const activity30d = buildEmptyWindow();

  for (const row of activityRows) {
    if (row.createdAt >= last30dStart) {
      applyActivityEvent(activity30d, row.metadata);
    }
    if (row.createdAt >= last7dStart) {
      applyActivityEvent(activity7d, row.metadata);
    }
  }

  const linkedBySource = {
    hubspot: linkedHubspot,
    zuper: linkedZuper,
    zoho: linkedZoho,
  } as const;

  const catalogCounts: Record<string, number> = {};
  for (const row of catalogGroupCounts) {
    catalogCounts[row.source.toLowerCase()] = row._count._all;
  }

  return NextResponse.json({
    generatedAt: now.toISOString(),
    windows: {
      last7dStart: last7dStart.toISOString(),
      last30dStart: last30dStart.toISOString(),
    },
    inventory: {
      totalActiveSkus,
      linkedBySource: {
        hubspot: {
          count: linkedBySource.hubspot,
          coveragePct: toPercent(linkedBySource.hubspot, totalActiveSkus),
        },
        zuper: {
          count: linkedBySource.zuper,
          coveragePct: toPercent(linkedBySource.zuper, totalActiveSkus),
        },
        zoho: {
          count: linkedBySource.zoho,
          coveragePct: toPercent(linkedBySource.zoho, totalActiveSkus),
        },
      },
      fullyLinkedAllSources: {
        count: fullyLinkedAll,
        coveragePct: toPercent(fullyLinkedAll, totalActiveSkus),
      },
      missingAnyLinkCount: Math.max(totalActiveSkus - fullyLinkedAll, 0),
    },
    activity: {
      last7d: activity7d,
      last30d: activity30d,
      lastEventAt: toIsoDate(lastActivity?.createdAt ?? null),
    },
    catalogCache: {
      bySource: catalogCounts,
    },
  });
}
