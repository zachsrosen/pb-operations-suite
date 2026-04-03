import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";
import { appCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

/**
 * IDR Meeting Presence — lightweight heartbeat system.
 *
 * POST  — heartbeat (user sends their current state: sessionId, selectedItemId)
 * GET   — returns all active users for a given sessionId (or preview)
 *
 * Stored in-memory (Map). Entries expire after 15 seconds of silence.
 * On every heartbeat the presence cache key is touched, which triggers
 * an SSE broadcast so all other clients see the update immediately.
 */

interface PresenceEntry {
  email: string;
  name: string | null;
  image: string | null;
  sessionId: string | null; // null = preview mode
  selectedItemId: string | null;
  lastSeen: number;
}

// In-memory presence store (serverless: per-instance, good enough for meetings)
const presenceMap = new Map<string, PresenceEntry>();
const EXPIRY_MS = 15_000; // 15 seconds without heartbeat = gone

function pruneStale() {
  const cutoff = Date.now() - EXPIRY_MS;
  for (const [email, entry] of presenceMap) {
    if (entry.lastSeen < cutoff) presenceMap.delete(email);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { sessionId, selectedItemId } = body;

  const prev = presenceMap.get(auth.email);
  const changed =
    !prev ||
    prev.sessionId !== (sessionId ?? null) ||
    prev.selectedItemId !== (selectedItemId ?? null);

  presenceMap.set(auth.email, {
    email: auth.email,
    name: auth.name ?? null,
    image: auth.image ?? null,
    sessionId: sessionId ?? null,
    selectedItemId: selectedItemId ?? null,
    lastSeen: Date.now(),
  });

  // Only broadcast if something actually changed (not every heartbeat)
  if (changed) {
    appCache.invalidate("idr-meeting:presence");
  }

  pruneStale();

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId"); // null = preview

  pruneStale();

  const users: PresenceEntry[] = [];
  for (const entry of presenceMap.values()) {
    // Show users in the same view (same session or both in preview)
    if (sessionId ? entry.sessionId === sessionId : entry.sessionId === null) {
      users.push(entry);
    }
  }

  return NextResponse.json({ users });
}

export async function DELETE() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  presenceMap.delete(auth.email);
  appCache.invalidate("idr-meeting:presence");

  return NextResponse.json({ ok: true });
}
