/**
 * POST /api/webhooks/google-chat
 *
 * Google Chat webhook for OOO bot. Receives messages from Google Chat,
 * returns an immediate acknowledgment, then fires Claude processing
 * asynchronously via waitUntil.
 *
 * Auth: Google JWT verified via jose against Google's JWKS.
 * Listed in PUBLIC_API_ROUTES — signature validation happens here.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyGoogleChatJwt } from "@/lib/google-chat-auth";
import { prisma } from "@/lib/db";
import { safeWaitUntil } from "@/lib/safe-wait-until";

export const runtime = "nodejs";
export const maxDuration = 60;

// ── Google Chat event types ──

interface GoogleChatUser {
  name?: string;
  displayName?: string;
  email?: string;
  type?: string;
}

interface GoogleChatMessage {
  name?: string;
  text?: string;
  sender?: GoogleChatUser;
  thread?: { name?: string };
  space?: {
    name?: string;
    displayName?: string;
    type?: string;
  };
  argumentText?: string;
  createTime?: string;
}

interface GoogleChatEvent {
  type?: string;
  eventTime?: string;
  message?: GoogleChatMessage;
  user?: GoogleChatUser;
  space?: {
    name?: string;
    displayName?: string;
    type?: string;
  };
}

// ── Welcome messages ──

const DM_WELCOME = `Hey — Zach's off pretending mountains exist outside of Colorado. I'm his AI stand-in. I've got his playbook, access to the live data, and zero ability to approve PTO. What's up?`;

const SPACE_WELCOME = `👋 Zach's OOO bot reporting for duty. I've got his playbook loaded and can look up projects, schedules, and pipeline status. I can't approve anything or make promises, but I can usually point you in the right direction. If I'm stumped, I'll flag it for Zach when he's back June 10th.`;

const THINKING_MESSAGE = `🤔 Let me check on that...`;

// ── Route handler ──

export async function POST(request: NextRequest) {
  // ── Kill switch ──
  const enabled = (process.env.GOOGLE_CHAT_ENABLED || "false").toLowerCase().trim();
  if (enabled !== "true" && enabled !== "1") {
    return NextResponse.json({ text: "OOO bot is currently disabled." });
  }

  // ── JWT auth ──
  const authHeader = request.headers.get("authorization");
  const authResult = await verifyGoogleChatJwt(authHeader);
  if (!authResult.valid) {
    console.error(`[google-chat] JWT verification failed: ${authResult.error}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse event ──
  let event: GoogleChatEvent;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type;

  // ── REMOVED_FROM_SPACE: no-op ──
  if (eventType === "REMOVED_FROM_SPACE") {
    return NextResponse.json({});
  }

  // ── ADDED_TO_SPACE: welcome message (sync) ──
  if (eventType === "ADDED_TO_SPACE") {
    const isRoom = event.space?.type === "ROOM";
    return NextResponse.json({ text: isRoom ? SPACE_WELCOME : DM_WELCOME });
  }

  // ── MESSAGE: async processing ──
  if (eventType === "MESSAGE") {
    const message = event.message;
    const senderEmail = message?.sender?.email ?? event.user?.email;
    const senderName = message?.sender?.displayName ?? event.user?.displayName ?? "Unknown";
    const spaceName = message?.space?.name ?? event.space?.name;
    const threadName = message?.thread?.name;
    const messageText = message?.argumentText ?? message?.text ?? "";
    const messageName = message?.name;

    // ── Sender domain filtering ──
    if (!senderEmail?.endsWith("@photonbrothers.com")) {
      return NextResponse.json({
        text: "I only respond to Photon Brothers team members.",
      });
    }

    if (!spaceName) {
      console.error("[google-chat] MESSAGE event missing space name");
      return NextResponse.json({});
    }

    if (!messageText.trim()) {
      return NextResponse.json({ text: "I can only respond to text messages." });
    }

    // ── Idempotency check ──
    if (messageName) {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key_scope: { key: messageName, scope: "google-chat" } },
      });
      if (existing) {
        return NextResponse.json({});
      }
      await prisma.idempotencyKey.create({
        data: {
          key: messageName,
          scope: "google-chat",
          status: "processing",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    // ── DB config check ──
    const config = await prisma.oooBotConfig.findFirst();
    if (config && !config.enabled) {
      return NextResponse.json({
        text: "The OOO bot is currently turned off. Reach out to Caleb or Patrick if you need help.",
      });
    }

    // ── Fire async Claude processing ──
    safeWaitUntil(
      (async () => {
        try {
          const { processOooBotMessage } = await import("@/lib/ooo-bot");
          await processOooBotMessage({
            messageText,
            senderEmail,
            senderName,
            spaceName,
            threadName: threadName ?? undefined,
            spaceDisplayName: message?.space?.displayName ?? event.space?.displayName,
            playbook: config?.playbook ?? "",
          });
        } catch (err) {
          console.error("[google-chat] Async processing failed:", err);
          try {
            const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
            await postGoogleChatMessage({
              spaceName,
              threadName: threadName ?? undefined,
              text: "I ran into a technical issue processing that. Try again in a minute — if it keeps happening, ping Caleb or Patrick on IT.",
            });
          } catch (postErr) {
            console.error("[google-chat] Failed to post error fallback:", postErr);
          }
        }
      })()
    );

    // ── Return immediate ack ──
    return NextResponse.json({ text: THINKING_MESSAGE });
  }

  // ── Unknown event type: no-op ──
  return NextResponse.json({});
}
