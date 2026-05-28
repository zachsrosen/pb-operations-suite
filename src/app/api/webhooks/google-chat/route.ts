/**
 * POST /api/webhooks/google-chat
 *
 * Google Chat webhook for OOO bot. Receives messages from Google Chat,
 * returns an immediate acknowledgment, then fires Claude processing
 * asynchronously via waitUntil.
 *
 * The app is configured as a Google Workspace add-on, so requests arrive
 * wrapped in a `chat.{messagePayload|addedToSpacePayload|...}` envelope and
 * responses must use the `hostAppDataAction` format. We also support the
 * legacy classic Chat bot envelope (`event.type` / `event.message`) as a
 * fallback for robustness and local testing.
 *
 * Auth: Google JWT verified via jose against Google's JWKS.
 * Listed in PUBLIC_API_ROUTES — signature validation happens here.
 */

import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyGoogleChatJwt } from "@/lib/google-chat-auth";
import { prisma } from "@/lib/db";

/**
 * Keep a background promise alive after the response is returned.
 * Uses Vercel's waitUntil (statically imported). Falls back to
 * fire-and-forget locally where waitUntil throws outside a request scope.
 */
function keepAlive(promise: Promise<void>) {
  try {
    waitUntil(promise);
  } catch {
    promise.catch((err) => console.error("[google-chat] background error:", err));
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;

// ── Google Chat shapes (subset we read) ──

interface ChatUser {
  name?: string;
  displayName?: string;
  email?: string;
  type?: string;
}

interface ChatSpace {
  name?: string;
  displayName?: string;
  type?: string; // "DM" | "ROOM" | "SPACE"
  spaceType?: string;
}

interface ChatMessage {
  name?: string;
  text?: string;
  argumentText?: string;
  sender?: ChatUser;
  thread?: { name?: string; threadKey?: string };
  space?: ChatSpace;
}

// Add-on envelope: { chat: { messagePayload | addedToSpacePayload | ... } }
interface AddOnPayload {
  message?: ChatMessage;
  space?: ChatSpace;
  user?: ChatUser;
  configCompleteRedirectUri?: string;
}

interface GoogleChatEvent {
  // classic envelope
  type?: string;
  message?: ChatMessage;
  user?: ChatUser;
  space?: ChatSpace;
  // add-on envelope
  chat?: {
    messagePayload?: AddOnPayload;
    addedToSpacePayload?: AddOnPayload;
    removedFromSpacePayload?: AddOnPayload;
    appCommandPayload?: AddOnPayload;
    buttonClickedPayload?: AddOnPayload;
  };
  commonEventObject?: unknown;
}

type NormalizedEventType =
  | "MESSAGE"
  | "ADDED_TO_SPACE"
  | "REMOVED_FROM_SPACE"
  | "OTHER";

interface NormalizedEvent {
  isAddOn: boolean;
  type: NormalizedEventType;
  message?: ChatMessage;
  space?: ChatSpace;
  user?: ChatUser;
}

// ── Welcome messages ──

const DM_WELCOME = `Hey — Zach's off pretending mountains exist outside of Colorado. I'm his AI stand-in. I've got his playbook, access to the live data, and zero ability to approve PTO. What's up?`;

const SPACE_WELCOME = `👋 Zach's OOO bot reporting for duty. I've got his playbook loaded and can look up projects, schedules, and pipeline status. I can't approve anything or make promises, but I can usually point you in the right direction. If I'm stumped, I'll flag it for Zach when he's back June 10th.`;

const THINKING_MESSAGE = `🤔 Let me check on that...`;

// ── Envelope helpers ──

/** Normalize either the add-on or classic envelope into a common shape. */
function normalizeEvent(event: GoogleChatEvent): NormalizedEvent {
  // Add-on envelope
  if (event.chat) {
    const c = event.chat;
    if (c.messagePayload) {
      return {
        isAddOn: true,
        type: "MESSAGE",
        message: c.messagePayload.message,
        space: c.messagePayload.space ?? c.messagePayload.message?.space,
        user: c.messagePayload.user ?? c.messagePayload.message?.sender,
      };
    }
    if (c.addedToSpacePayload) {
      return {
        isAddOn: true,
        type: "ADDED_TO_SPACE",
        space: c.addedToSpacePayload.space,
        user: c.addedToSpacePayload.user,
      };
    }
    if (c.removedFromSpacePayload) {
      return { isAddOn: true, type: "REMOVED_FROM_SPACE" };
    }
    // appCommandPayload / buttonClickedPayload / etc. — treat as message-ish
    if (c.appCommandPayload) {
      return {
        isAddOn: true,
        type: "MESSAGE",
        message: c.appCommandPayload.message,
        space: c.appCommandPayload.space ?? c.appCommandPayload.message?.space,
        user: c.appCommandPayload.user ?? c.appCommandPayload.message?.sender,
      };
    }
    return { isAddOn: true, type: "OTHER" };
  }

  // Classic envelope
  const t = event.type;
  const type: NormalizedEventType =
    t === "MESSAGE"
      ? "MESSAGE"
      : t === "ADDED_TO_SPACE"
        ? "ADDED_TO_SPACE"
        : t === "REMOVED_FROM_SPACE"
          ? "REMOVED_FROM_SPACE"
          : "OTHER";
  return {
    isAddOn: false,
    type,
    message: event.message,
    space: event.space ?? event.message?.space,
    user: event.user ?? event.message?.sender,
  };
}

/** Build the correct text response for the active envelope. */
function chatTextResponse(text: string, isAddOn: boolean) {
  if (isAddOn) {
    return NextResponse.json({
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { text },
          },
        },
      },
    });
  }
  return NextResponse.json({ text });
}

/** Empty/no-op response for the active envelope. */
function chatNoop(isAddOn: boolean) {
  if (isAddOn) {
    return NextResponse.json({ hostAppDataAction: { chatDataAction: {} } });
  }
  return NextResponse.json({});
}

function isRoomSpace(space?: ChatSpace): boolean {
  return space?.type === "ROOM" || space?.spaceType === "SPACE";
}

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
  let rawEvent: GoogleChatEvent;
  try {
    rawEvent = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = normalizeEvent(rawEvent);
  const { isAddOn } = event;
  console.warn(
    `[google-chat] event type=${event.type} addOn=${isAddOn} space=${event.space?.name ?? "?"}`
  );

  // ── REMOVED_FROM_SPACE: no-op ──
  if (event.type === "REMOVED_FROM_SPACE") {
    return chatNoop(isAddOn);
  }

  // ── ADDED_TO_SPACE: welcome message (sync) ──
  if (event.type === "ADDED_TO_SPACE") {
    return chatTextResponse(
      isRoomSpace(event.space) ? SPACE_WELCOME : DM_WELCOME,
      isAddOn
    );
  }

  // ── MESSAGE: async processing ──
  if (event.type === "MESSAGE") {
    const message = event.message;
    const senderEmail = message?.sender?.email ?? event.user?.email;
    const senderName =
      message?.sender?.displayName ?? event.user?.displayName ?? "Unknown";
    const spaceName = event.space?.name ?? message?.space?.name;
    const threadName = message?.thread?.name;
    const messageText = message?.argumentText ?? message?.text ?? "";
    const messageName = message?.name;

    // ── Sender domain filtering ──
    if (!senderEmail?.endsWith("@photonbrothers.com")) {
      return chatTextResponse(
        "I only respond to Photon Brothers team members.",
        isAddOn
      );
    }

    if (!spaceName) {
      console.error("[google-chat] MESSAGE event missing space name");
      return chatNoop(isAddOn);
    }

    if (!messageText.trim()) {
      return chatTextResponse("I can only respond to text messages.", isAddOn);
    }

    // ── Idempotency check ──
    if (messageName) {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key_scope: { key: messageName, scope: "google-chat" } },
      });
      if (existing) {
        return chatNoop(isAddOn);
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
      return chatTextResponse(
        "The OOO bot is currently turned off. Reach out to Caleb or Patrick if you need help.",
        isAddOn
      );
    }

    // ── Fire async Claude processing ──
    keepAlive(
      (async () => {
        console.warn(
          `[google-chat] async START space=${spaceName} sender=${senderEmail}`
        );
        try {
          const { processOooBotMessage } = await import("@/lib/ooo-bot");
          await processOooBotMessage({
            messageText,
            senderEmail,
            senderName,
            spaceName,
            threadName: threadName ?? undefined,
            spaceDisplayName: event.space?.displayName,
            playbook: config?.playbook ?? "",
          });
          console.warn(`[google-chat] async DONE space=${spaceName}`);
        } catch (err) {
          console.error("[google-chat] Async processing failed:", err);
          // Persist the error to the DB so it can be diagnosed without
          // relying on (sampled) Vercel logs.
          try {
            await prisma.oooBotEscalation.create({
              data: {
                senderEmail: "DEBUG",
                senderName: "async-error",
                question: messageText.slice(0, 200),
                botContext: (err instanceof Error ? err.message : String(err)).slice(0, 900),
                spaceId: spaceName,
                threadId: threadName ?? null,
                status: "PENDING",
              },
            });
          } catch (dbErr) {
            console.error("[google-chat] Failed to persist debug error:", dbErr);
          }
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
    return chatTextResponse(THINKING_MESSAGE, isAddOn);
  }

  // ── Unknown event type: no-op ──
  return chatNoop(isAddOn);
}
