/**
 * OOO Bot Orchestrator
 *
 * Core logic: loads conversation history, builds system prompt,
 * calls Claude with toolRunner, persists conversation, posts response
 * via Google Chat API.
 *
 * Called from the webhook route's waitUntil() — runs asynchronously
 * after the immediate "thinking..." response.
 */

import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import { createReadOnlyChatTools } from "@/lib/chat-tools";
import { createOooBotTools } from "@/lib/ooo-bot-tools";
import { postGoogleChatMessage } from "@/lib/google-chat-api";
import { prisma } from "@/lib/db";

// ── System Prompt Builder ──

interface SystemPromptParams {
  playbook: string;
  senderName: string;
  senderEmail: string;
  spaceDisplayName?: string;
}

const IDENTITY_PROMPT = `You are Zach's OOO assistant for the precon team at Photon Brothers (a solar installation company). Zach is out of office from May 29 to June 10, 2026.

You have Zach's operational playbook and access to live project data. You help the precon team with process questions, project status lookups, scheduling visibility, and general guidance based on how Zach runs things.

RULES:
- Always identify yourself as Zach's OOO bot, never pretend to be Zach
- You CANNOT: approve things, make commitments, change data, reassign crews, move deals, send emails, or override anyone's decisions
- If you're not confident in an answer, use the escalate tool to flag it for Zach's return
- When you escalate, tell the person it's been queued for Zach
- For process/how-to questions, use the search_sop tool first — the SOP guides have most standard procedures documented
- Be helpful, direct, and a little funny — like a coworker who knows the playbook and has a sense of humor about being a robot filling in

TONE:
- Casual and direct, not corporate
- Self-aware about being an AI ("above my pay grade — I don't have one")
- Confident when you know the answer, honest when you don't
- Brief — nobody wants a novel in Google Chat

AVAILABLE TOOLS:
- get_deal(dealId) — HubSpot deal properties
- search_deals(query) — search deals by name/text
- filter_deals_by_stage(stage) — find deals in a pipeline stage
- count_deals_by_stage() — pipeline stage counts
- get_project_status(projectId) — combined deal + Zuper + BOM status
- get_schedule_overview(location?, days?) — upcoming installs/surveys
- get_service_queue() — service priority queue summary
- escalate(question, context) — flag for Zach's return
- search_sop(query) — search SOP guides for process docs

KEY CONTEXT:
- Projects are identified by PROJ-XXXX numbers in deal names
- Locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo
- Pipeline stages: Site Survey > Design & Engineering > Permitting & Interconnection > RTB - Blocked > Ready To Build > Construction > Inspection > Permission To Operate > Close Out`;

export function buildOooBotSystemPrompt(params: SystemPromptParams): string {
  let prompt = IDENTITY_PROMPT;

  // Layer 2: Playbook
  if (params.playbook.trim()) {
    prompt += `\n\n--- ZACH'S PLAYBOOK ---\n${params.playbook}`;
  }

  // Layer 3: Live context
  prompt += `\n\n--- CURRENT CONTEXT ---`;
  prompt += `\nCurrent date/time: ${new Date().toLocaleString("en-US", { timeZone: "America/Denver" })}`;
  prompt += `\nMessage from: ${params.senderName} (${params.senderEmail})`;
  prompt += `\nSpace: ${params.spaceDisplayName || "Direct Message"}`;

  return prompt;
}

// ── Message Processor ──

interface ProcessMessageParams {
  messageText: string;
  senderEmail: string;
  senderName: string;
  spaceName: string;
  threadName?: string;
  spaceDisplayName?: string;
  playbook: string;
}

export async function processOooBotMessage(params: ProcessMessageParams): Promise<void> {
  const {
    messageText,
    senderEmail,
    senderName,
    spaceName,
    threadName,
    spaceDisplayName,
    playbook,
  } = params;

  // ── Load conversation history ──
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (prisma) {
    const rows = await prisma.oooBotConversation.findMany({
      where: {
        spaceId: spaceName,
        ...(threadName ? { threadId: threadName } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { role: true, content: true },
    });
    // Reverse so oldest first
    history = rows.reverse().map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
    }));
  }

  // ── Build system prompt ──
  const systemPrompt = buildOooBotSystemPrompt({
    playbook,
    senderName,
    senderEmail,
    spaceDisplayName,
  });

  // ── Build messages ──
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history,
    { role: "user", content: messageText },
  ];

  // ── Build tools ──
  const readOnlyTools = createReadOnlyChatTools();
  const rawOooTools = createOooBotTools();

  // Wrap the escalate tool to inject request context
  const oooTools = rawOooTools.map((tool) => {
    if (tool.name === "escalate") {
      return {
        ...tool,
        run: async (input: { question: string; context: string }) => {
          // Write escalation with real context
          if (prisma) {
            await prisma.oooBotEscalation.create({
              data: {
                senderEmail,
                senderName,
                question: input.question,
                botContext: input.context,
                spaceId: spaceName,
                threadId: threadName,
                status: "PENDING",
              },
            });
          }
          return JSON.stringify({
            escalated: true,
            message: "Flagged for Zach — he's back June 10th.",
          });
        },
      };
    }
    return tool;
  });

  // ── Wrap all tools to track usage ──
  // toolRunner returns only the final text message — intermediate tool_use
  // blocks are internal. We track usage by wrapping each tool's run function.
  const toolsUsedSet = new Set<string>();
  const allTools = [...readOnlyTools, ...oooTools].map((tool) => ({
    ...tool,
    run: async (input: unknown) => {
      toolsUsedSet.add(tool.name);
      return (tool.run as (input: unknown) => Promise<string>)(input);
    },
  }));

  // ── Call Claude ──
  const client = getAnthropicClient();

  const finalMessage = await client.beta.messages.toolRunner({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    tools: allTools as Parameters<typeof client.beta.messages.toolRunner>[0]["tools"],
    max_iterations: 5,
  });

  // Extract text response
  const textBlocks = finalMessage.content.filter(
    (b): b is Extract<typeof b, { type: "text" }> => b.type === "text"
  );
  const responseText = textBlocks.map((b) => b.text).join("");

  const toolsUsed = [...toolsUsedSet];

  // ── Persist conversation ──
  if (prisma) {
    await prisma.$transaction([
      prisma.oooBotConversation.create({
        data: {
          spaceId: spaceName,
          threadId: threadName,
          senderEmail,
          senderName,
          role: "user",
          content: messageText,
        },
      }),
      prisma.oooBotConversation.create({
        data: {
          spaceId: spaceName,
          threadId: threadName,
          senderEmail: "bot",
          senderName: "Zach's OOO Bot",
          role: "assistant",
          content: responseText,
          model: CLAUDE_MODELS.sonnet,
          toolsUsed,
        },
      }),
    ]);
  }

  // ── Post response to Google Chat ──
  // Post to the main conversation timeline (no thread) so the answer
  // appears inline next to the user's question rather than hidden in a
  // reply thread — better UX for a DM/assistant bot.
  console.warn(
    `[ooo-bot] posting reply to ${spaceName} (len=${responseText.length}, tools=${toolsUsed.join(",")})`
  );
  await postGoogleChatMessage({
    spaceName,
    text: responseText || "I processed your message but didn't have anything to say. Try asking a specific question?",
  });
  console.warn(`[ooo-bot] reply posted to ${spaceName}`);
}
