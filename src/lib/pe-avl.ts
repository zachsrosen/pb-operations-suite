/**
 * PE Approved Vendor List (AVL) — fetch and cache from Raceway API.
 *
 * GET /v1/avl returns the list of equipment PE has approved.
 * We cache it in DB with a 24-hour TTL so audits don't re-fetch every run.
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeAvlEntry {
  id: string;
  sku: string;
  manufacturer: string;
  description: string | null;
  category: string;
  [key: string]: unknown;
}

export interface PeAvlData {
  entries: PeAvlEntry[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://pe-paddock-api.raceway.ai";

async function fetchAvlFromApi(): Promise<PeAvlEntry[]> {
  const apiKey = process.env.PE_API_KEY;
  if (!apiKey) throw new Error("PE_API_KEY not set");
  const baseUrl = process.env.PE_API_BASE_URL || DEFAULT_BASE_URL;

  const res = await fetch(`${baseUrl}/v1/avl`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PE AVL fetch failed: ${res.status} — ${body.substring(0, 300)}`);
  }

  const json = await res.json();

  if (Array.isArray(json)) return json as PeAvlEntry[];
  if (json.data?.items && Array.isArray(json.data.items)) return json.data.items as PeAvlEntry[];
  if (json.data && Array.isArray(json.data)) return json.data as PeAvlEntry[];
  if (json.data?.entries && Array.isArray(json.data.entries)) return json.data.entries as PeAvlEntry[];

  console.warn("[pe-avl] Unexpected AVL response shape, wrapping as-is");
  return [json] as PeAvlEntry[];
}

// ---------------------------------------------------------------------------
// Cached accessor — 24-hour TTL
// ---------------------------------------------------------------------------

const AVL_TTL_MS = 24 * 60 * 60 * 1000;

export async function getAvl(): Promise<PeAvlData> {
  const cached = await prisma.peAvlCache.findFirst({
    where: { expiresAt: { gt: new Date() } },
    orderBy: { fetchedAt: "desc" },
  });

  if (cached) {
    return cached.data as unknown as PeAvlData;
  }

  const entries = await fetchAvlFromApi();
  const data: PeAvlData = {
    entries,
    fetchedAt: new Date().toISOString(),
  };

  await prisma.peAvlCache.create({
    data: {
      data: JSON.parse(JSON.stringify(data)),
      expiresAt: new Date(Date.now() + AVL_TTL_MS),
    },
  });

  return data;
}

// ---------------------------------------------------------------------------
// Equipment cross-check
// ---------------------------------------------------------------------------

export interface AvlCheckResult {
  sku: string;
  onAvl: boolean;
  matchedEntry?: PeAvlEntry;
}

export function checkEquipmentAgainstAvl(
  equipment: { moduleSku?: string; inverterSku?: string; rackingPartNumber?: string },
  avl: PeAvlData,
): AvlCheckResult[] {
  const results: AvlCheckResult[] = [];
  const skus = [
    equipment.moduleSku,
    equipment.inverterSku,
    equipment.rackingPartNumber,
  ].filter(Boolean) as string[];

  for (const sku of skus) {
    const normalized = sku.toLowerCase().replace(/[\s\-_]/g, "");
    const match = avl.entries.find((e) => {
      const entryNorm = (e.sku || "").toLowerCase().replace(/[\s\-_]/g, "");
      const descNorm = (e.description || "").toLowerCase().replace(/[\s\-_]/g, "");
      return entryNorm === normalized || descNorm === normalized || entryNorm.includes(normalized) || normalized.includes(entryNorm);
    });

    results.push({
      sku,
      onAvl: !!match,
      matchedEntry: match,
    });
  }

  return results;
}
