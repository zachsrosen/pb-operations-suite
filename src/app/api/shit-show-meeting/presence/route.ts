import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Shit Show Meeting Presence — lightweight heartbeat system.
 *
 * POST   — heartbeat (sessionId, selectedItemId)
 * GET    — returns all active users for a given sessionId
 * DELETE — signal departure
 *
 * In-memory Map with 20s TTL. Mirrors the IDR meeting presence pattern with
 * its own Map (independent so users in IDR and Shit Show don't appear in each
 * other's bucket).
 */

interface PresenceEntry {
  email: string;
  name: string | null;
  sessionId: string | null;
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

  const body = (await req.json()) as {
    sessionId?: string;
    selectedItemId?: string | null;
  };

  presenceMap.set(auth.email, {
    email: auth.email,
    name: auth.name ?? null,
    sessionId: body.sessionId ?? null,
    selectedItemId: body.selectedItemId ?? null,
    lastSeen: Date.now(),
  });

  prune();
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  prune();

  const users: PresenceEntry[] = [];
  for (const entry of presenceMap.values()) {
    if (sessionId && entry.sessionId === sessionId) users.push(entry);
  }

  return NextResponse.json({ users });
}

export async function DELETE() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  presenceMap.delete(auth.email);
  return NextResponse.json({ ok: true });
}
