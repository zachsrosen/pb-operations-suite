import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * IDR Meeting Presence — lightweight heartbeat system backed by Redis.
 *
 * POST  — heartbeat (user sends their current state: sessionId, selectedItemId)
 * GET   — returns all active users for a given sessionId (or preview)
 * DELETE — signal departure
 *
 * Each user gets a Redis key `idr:presence:{email}` with a 20s TTL.
 * Entries auto-expire if the client stops sending heartbeats.
 * Falls back to in-memory Map when Redis is not configured.
 */

interface PresenceEntry {
  email: string;
  name: string | null;
  sessionId: string | null; // null = preview mode
  selectedItemId: string | null;
  lastSeen: number;
}

const REDIS_PREFIX = "idr:presence:";
const TTL_SECONDS = 20;

// Fallback in-memory store (used when Redis not configured)
const memoryMap = new Map<string, PresenceEntry>();
const EXPIRY_MS = TTL_SECONDS * 1000;

// ── Redis-backed implementation ──

async function redisSet(entry: PresenceEntry): Promise<void> {
  if (!redis) return;
  await redis.set(REDIS_PREFIX + entry.email, JSON.stringify(entry), { ex: TTL_SECONDS });
}

async function redisDel(email: string): Promise<void> {
  if (!redis) return;
  await redis.del(REDIS_PREFIX + email);
}

async function redisGetAll(): Promise<PresenceEntry[]> {
  if (!redis) return [];
  // SCAN for all presence keys
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: REDIS_PREFIX + "*", count: 50 });
    cursor = Number(nextCursor);
    keys.push(...batch);
  } while (cursor !== 0);

  if (keys.length === 0) return [];

  const values = await redis.mget<string[]>(...keys);
  const entries: PresenceEntry[] = [];
  for (const val of values) {
    if (val) {
      try {
        entries.push(typeof val === "string" ? JSON.parse(val) : val as unknown as PresenceEntry);
      } catch { /* skip corrupted */ }
    }
  }
  return entries;
}

// ── In-memory fallback ──

function memPrune() {
  const cutoff = Date.now() - EXPIRY_MS;
  for (const [email, entry] of memoryMap) {
    if (entry.lastSeen < cutoff) memoryMap.delete(email);
  }
}

// ── Routes ──

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { sessionId, selectedItemId } = body;

  const entry: PresenceEntry = {
    email: auth.email,
    name: auth.name ?? null,
    sessionId: sessionId ?? null,
    selectedItemId: selectedItemId ?? null,
    lastSeen: Date.now(),
  };

  if (redis) {
    await redisSet(entry);
  } else {
    memoryMap.set(auth.email, entry);
    memPrune();
  }

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId"); // null = preview

  let allEntries: PresenceEntry[];
  if (redis) {
    allEntries = await redisGetAll();
  } else {
    memPrune();
    allEntries = [...memoryMap.values()];
  }

  // Filter to users in the same view
  const users = allEntries.filter((e) =>
    sessionId ? e.sessionId === sessionId : e.sessionId === null,
  );

  return NextResponse.json({ users });
}

export async function DELETE() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  if (redis) {
    await redisDel(auth.email);
  } else {
    memoryMap.delete(auth.email);
  }

  return NextResponse.json({ ok: true });
}
