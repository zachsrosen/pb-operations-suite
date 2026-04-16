import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 30;

type ObjectType = "deal" | "ticket" | null;

/**
 * POST /api/hubspot/object-resolve
 * Body: { ids: string[] }
 * Response: { types: Record<id, "deal" | "ticket" | null> }
 *
 * Determines whether each HubSpot object ID is a deal or a ticket.
 * Zuper stores either in external_id.hubspot_deal (legacy field name) —
 * this resolves the actual object type by probing the HubSpot CRM.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "HubSpot not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).map(String).map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ types: {} });
  }

  const unique = Array.from(new Set(ids));
  const types: Record<string, ObjectType> = {};
  for (const id of unique) types[id] = null;

  async function batchRead(objectType: "deals" | "tickets", batch: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    if (batch.length === 0) return found;
    try {
      const res = await fetch(
        `https://api.hubapi.com/crm/v3/objects/${objectType}/batch/read`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            properties: ["hs_object_id"],
            inputs: batch.map((id) => ({ id })),
          }),
          cache: "no-store",
        }
      );
      if (!res.ok) {
        // Partial failures still return 207 with results; other errors return 4xx/5xx.
        // Try to read the body anyway — HubSpot returns results[] even on 207.
        if (res.status !== 207) return found;
      }
      const data = await res.json() as {
        results?: Array<{ id: string }>;
      };
      for (const r of data.results ?? []) {
        if (r?.id) found.add(String(r.id));
      }
    } catch (err) {
      console.warn(`[object-resolve] ${objectType} batch read failed:`, err);
    }
    return found;
  }

  // Chunk to HubSpot batch limit (100).
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    chunks.push(unique.slice(i, i + CHUNK));
  }

  // First pass: deals.
  for (const batch of chunks) {
    const found = await batchRead("deals", batch);
    for (const id of found) types[id] = "deal";
  }

  // Second pass: anything still unresolved — try tickets.
  const remaining = unique.filter((id) => types[id] === null);
  const remainingChunks: string[][] = [];
  for (let i = 0; i < remaining.length; i += CHUNK) {
    remainingChunks.push(remaining.slice(i, i + CHUNK));
  }
  for (const batch of remainingChunks) {
    const found = await batchRead("tickets", batch);
    for (const id of found) types[id] = "ticket";
  }

  return NextResponse.json({ types });
}
