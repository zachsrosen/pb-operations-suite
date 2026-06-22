// ---------------------------------------------------------------------------
// Workflow Map snapshot store
//
// Thin SystemConfig JSON accessors for the Workflow Map feature. The full
// rendered snapshot lives in one JSON row (`hubspot_flow_map`); a per-flow
// detail cache (keyed by flow id, holding the flow's revisionId + rendered
// FlowEntry) lives in another (`hubspot_flow_detail_cache`) so incremental
// syncs can skip detail fetches for unchanged flows.
//
// No business logic here — just read/parse and stringify/upsert. Mirrors the
// findUnique/upsert shape from `pe-uploader-overrides.ts`.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import type { FlowEntry, FlowMapSnapshot } from "@/lib/flow-map/types";

const SNAPSHOT_KEY = "hubspot_flow_map";
const DETAIL_CACHE_KEY = "hubspot_flow_detail_cache";

export type FlowDetailCache = Record<string, { revisionId: string; entry: FlowEntry }>;

export async function getSnapshot(): Promise<FlowMapSnapshot | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key: SNAPSHOT_KEY } });
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as FlowMapSnapshot) : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(s: FlowMapSnapshot): Promise<void> {
  if (!prisma) throw new Error("Database not available");
  await prisma.systemConfig.upsert({
    where: { key: SNAPSHOT_KEY },
    create: { key: SNAPSHOT_KEY, value: JSON.stringify(s) },
    update: { value: JSON.stringify(s) },
  });
}

export async function getDetailCache(): Promise<FlowDetailCache> {
  if (!prisma) return {};
  const row = await prisma.systemConfig.findUnique({ where: { key: DETAIL_CACHE_KEY } });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as FlowDetailCache) : {};
  } catch {
    return {};
  }
}

export async function writeDetailCache(c: FlowDetailCache): Promise<void> {
  if (!prisma) throw new Error("Database not available");
  await prisma.systemConfig.upsert({
    where: { key: DETAIL_CACHE_KEY },
    create: { key: DETAIL_CACHE_KEY, value: JSON.stringify(c) },
    update: { value: JSON.stringify(c) },
  });
}
