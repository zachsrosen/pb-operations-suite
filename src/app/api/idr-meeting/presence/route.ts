import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { isIdrAllowedRole } from "@/lib/idr-meeting";

export const dynamic = "force-dynamic";

/**
 * IDR Meeting Presence — lightweight heartbeat system.
 *
 * POST  — heartbeat (user sends their current state: sessionId, selectedItemId)
 * GET   — returns all active users for a given sessionId (or preview)
 * DELETE — signal departure
 *
 * In-memory Map with 20s TTL. Entries auto-expire if the client
 * stops sending heartbeats.
 */

interface PresenceEntry {
  email: string;
  name: string | null;
  sessionId: string | null; // null = preview mode
  selectedItemId: string | null;
  lastSeen: number;
}

const presenceMap = new Map<string, PresenceEntry>();
const EXPIRY_MS = 20_000;

function prune() {
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

  presenceMap.set(auth.email, {
    email: auth.email,
    name: auth.name ?? null,
    sessionId: sessionId ?? null,
    selectedItemId: selectedItemId ?? null,
    lastSeen: Date.now(),
  });

  prune();
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isIdrAllowedRole(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  prune();

  const users: PresenceEntry[] = [];
  for (const entry of presenceMap.values()) {
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
  return NextResponse.json({ ok: true });
}
