/**
 * POST /api/chat
 *
 * Claude chat endpoint. Uses Anthropic SDK toolRunner for automatic
 * tool-use loop. Persists messages to ChatMessage table.
 *
 * Body: { message: string, dealId?: string, history?: { role, content }[] }
 * Auth: any authenticated user
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { isRateLimited } from "@/lib/ai";
import { createChatTools } from "@/lib/chat-tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an AI assistant for Photon Brothers, a solar installation company.
You help team members with project questions, review results, and operational data.

You have access to HubSpot deal data and review results. Use the tools provided to look up
specific projects when asked. Be concise and actionable.

Key context:
- Projects are identified by PROJ-XXXX numbers in deal names
- Locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo
- Pipeline stages: Site Survey > Design & Engineering > Permitting & Interconnection > RTB - Blocked > Ready To Build > Construction > Inspection > Permission To Operate > Close Out
- Review skills: design-review, engineering-review, sales-advisor

If you don't have enough information to answer, say so. Don't guess at deal data - use the tools.`;

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, role } = authResult;

  if (isRateLimited(email)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }

  let body: {
    message?: string;
    dealId?: string;
    history?: Array<{ role: string; content: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, dealId, history = [] } = body;
  if (!message || typeof message !== "string" || message.length > 2000) {
    return NextResponse.json(
      { error: "message is required (max 2000 chars)" },
      { status: 400 }
    );
  }

  // Build messages from history + new message
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-20).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: message },
  ];

  // Build system prompt with optional deal context
  let systemPrompt = SYSTEM_PROMPT;
  if (dealId) {
    systemPrompt += `\n\nThe user is currently viewing deal ID: ${dealId}. Use this context when answering questions about "this project" or "this deal".`;
  }
  systemPrompt += `\n\nUser role: ${role}. User email: ${email}.`;

  const client = getAnthropicClient();
  const model = dealId ? CLAUDE_MODELS.sonnet : CLAUDE_MODELS.haiku;
  const tools = createChatTools();

  try {
    const finalMessage = await client.beta.messages.toolRunner({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools,
      max_iterations: 5,
    });

    // Extract text from final response
    const textBlocks = finalMessage.content.filter(
      (b): b is Extract<typeof b, { type: "text" }> => b.type === "text"
    );
    const responseText = textBlocks.map((b) => b.text).join("");

    // Persist messages (skip if DB not configured)
    if (prisma) {
      await prisma.$transaction([
        prisma.chatMessage.create({
          data: { userId: email, dealId, role: "user", content: message },
        }),
        prisma.chatMessage.create({
          data: {
            userId: email,
            dealId,
            role: "assistant",
            content: responseText,
            model,
          },
        }),
      ]);
    }

    return NextResponse.json({ response: responseText, model });
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      {
        error: `Chat failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 500 }
    );
  }
}
