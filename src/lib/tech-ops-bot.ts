/**
 * Tech Ops Bot Orchestrator
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
import { createTechOpsBotTools } from "@/lib/tech-ops-bot-tools";
import { postGoogleChatMessage } from "@/lib/google-chat-api";
import { sendBugReportEmail } from "@/lib/email";
import { prisma, logActivity } from "@/lib/db";

// ── System Prompt Builder ──

interface SystemPromptParams {
  playbook: string;
  senderName: string;
  senderEmail: string;
  spaceDisplayName?: string;
}

const IDENTITY_PROMPT = `You are Zach's AI assistant for Zach's team at Photon Brothers (a solar installation company). You're always on — the team can reach you any time.

You have Zach's operational playbook and access to live project data. You help Zach's team with process questions, project status lookups, scheduling visibility, and general guidance based on how Zach runs things.

RULES:
- Always identify yourself as Zach's assistant bot, never pretend to be Zach
- You CANNOT: approve things, make commitments, change data, reassign crews, move deals, send emails, or override anyone's decisions
- Two exceptions, both ONLY when someone EXPLICITLY asks:
  - File a "process request" with submit_process_request — a request to add, change, or fix a process, workflow, or tool. Never file one on your own initiative; read the title back so they know what was logged.
  - Create a HubSpot task — when someone explicitly asks you to make/create a task, you MUST actually call the create_hubspot_task tool. This is critical: NEVER say "done" or claim a task was created unless that tool ran and returned a taskId. If you didn't call the tool, no task exists — do not fabricate it. When they reference a project by PROJ number, customer name, OR address, pass that string as projectId so the tool can find and attach the right deal — do NOT skip attachment by claiming you lack info; let the tool do the search (it will ask you to pick if there are several). You can CREATE tasks only (never edit, complete, or delete). After the tool returns, read back exactly what it reported — subject, due date, and the deal NAME it attached to — so they can confirm it landed on the right record.
- If you're not confident in an answer, use the escalate tool to flag it for Zach to follow up on
- When you escalate, tell the person it's been flagged for Zach
- For process/how-to questions, use the search_sop tool first — the SOP guides have most standard procedures documented
- DATA INTEGRITY (important): for any factual question about projects, deals, schedules, or counts, answer ONLY from a tool result — never from memory or assumption. For "how many" questions use count_deals_by_stage, or read the "total" field from filter_deals_by_stage — NEVER report the number of deals a list returned as the total (lists are capped at ~20). If a question needs a breakdown the tools don't provide (e.g. a sub-status like "waiting on DA to be sent"), say you can't break it down that way and offer to escalate — do not invent or estimate a number.
- Be helpful, direct, and a little funny — like a coworker who knows the playbook and has a sense of humor about being a robot

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
- count_deals_by_status(statusType, stage?) — break deals down by a status dimension. statusType: "da" = customer Design Approval (the layout/DA-send status), "design" = engineering design, "permitting", "interconnection", "site_survey". Use this for "how many are waiting on DA to be sent", "permitting status breakdown", etc. It returns each exact status value with its true count — read the bucket(s) that match the question (e.g. for "waiting on DA to be sent" look for the DA-draft-ready/ready-to-send buckets, not the already-sent ones).
- get_project_status(projectId) — combined deal + Zuper + BOM status
- get_schedule_overview(location?, days?) — upcoming installs/surveys
- get_service_queue() — service priority queue summary
- escalate(question, context) — flag for Zach to follow up
- search_sop(query) — search SOP guides for process docs
- submit_process_request(title, description) — file a process/tool request when someone explicitly asks
- create_hubspot_task(subject, body?, projectId?, dueInDays?) — create a HubSpot task (assigned to the requester) when someone explicitly asks

KEY CONTEXT:
- Projects are identified by PROJ-XXXX numbers in deal names
- Locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo
- Pipeline stages: Site Survey > Design & Engineering > Permitting & Interconnection > RTB - Blocked > Ready To Build > Construction > Inspection > Permission To Operate > Close Out`;

export function buildTechOpsBotSystemPrompt(params: SystemPromptParams): string {
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

export async function processTechOpsBotMessage(params: ProcessMessageParams): Promise<void> {
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
  // Scope by spaceId only (NOT threadId). In Google Chat DMs every message
  // lands in its own thread, so filtering by threadId fragmented history to a
  // single message and the bot had no memory between turns. The conversation
  // table only stores this bot's own Q&A pairs, so spaceId-scoped history is
  // exactly the prior conversation in this DM/room. (Fixes ticket #749.)
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (prisma) {
    const rows = await prisma.techOpsBotConversation.findMany({
      where: { spaceId: spaceName },
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
  const systemPrompt = buildTechOpsBotSystemPrompt({
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
  const rawBotTools = createTechOpsBotTools();

  // Wrap the escalate + submit_process_request tools to inject request
  // context (these are the only tools that write to the DB).
  const botTools = rawBotTools.map((tool) => {
    if (tool.name === "escalate") {
      return {
        ...tool,
        run: async (input: { question: string; context: string }) => {
          // Write escalation with real context
          if (prisma) {
            await prisma.techOpsBotEscalation.create({
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
            message: "Flagged for Zach to follow up.",
          });
        },
      };
    }
    if (tool.name === "submit_process_request") {
      return {
        ...tool,
        run: async (input: { title: string; description: string }) => {
          if (!prisma) {
            return JSON.stringify({
              submitted: false,
              message: "Couldn't log that right now — the database is unavailable.",
            });
          }

          // Stored as FEATURE_REQUEST under the hood; surfaced to the team
          // as a "process request" (same BugReport table as the in-app form).
          const report = await prisma.bugReport.create({
            data: {
              type: "FEATURE_REQUEST",
              title: input.title.slice(0, 200),
              description: input.description.slice(0, 5000),
              pageUrl: "via Tech Ops bot (Google Chat)",
              reporterEmail: senderEmail,
              reporterName: senderName,
            },
          });

          // Notify the team (fire-and-forget; don't fail the request on email).
          try {
            const emailResult = await sendBugReportEmail({
              reportId: report.id,
              type: report.type,
              title: report.title,
              description: report.description,
              pageUrl: report.pageUrl || undefined,
              reporterName: report.reporterName || undefined,
              reporterEmail: report.reporterEmail,
            });
            await prisma.bugReport.update({
              where: { id: report.id },
              data: { emailSent: emailResult.success },
            });
          } catch (err) {
            console.warn("[tech-ops-bot] process request email failed:", err);
          }

          try {
            await logActivity({
              type: "FEATURE_REQUESTED",
              description: `Process request submitted via Tech Ops bot: ${input.title}`,
              userEmail: senderEmail,
              userName: senderName,
              entityType: "bug_report",
              entityId: report.id,
              entityName: input.title,
              metadata: { type: "FEATURE_REQUEST", source: "tech-ops-bot", spaceId: spaceName },
              ipAddress: "google-chat",
              userAgent: "tech-ops-bot",
            });
          } catch (err) {
            console.warn("[tech-ops-bot] process request activity log failed:", err);
          }

          return JSON.stringify({
            submitted: true,
            reportId: report.id,
            title: report.title,
            message: "Logged your process request — the team's been notified.",
          });
        },
      };
    }
    if (tool.name === "create_hubspot_task") {
      return {
        ...tool,
        run: async (input: {
          subject: string;
          body?: string;
          projectId?: string;
          dueInDays?: number;
        }) => {
          const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
          if (!accessToken) {
            return JSON.stringify({
              created: false,
              message: "Task creation isn't configured right now.",
            });
          }

          try {
            const { searchWithRetry, hubspotClient } = await import("@/lib/hubspot");

            // ── Resolve the target deal (optional) ──
            // Accepts a PROJ number, a raw deal ID, OR a customer name / address.
            // The safety net is the same in every case: match exactly one deal or
            // don't guess (return candidates), and always surface the deal name so
            // the requester can confirm the task landed on the right record.
            let dealId: string | undefined;
            let dealName: string | undefined;
            if (input.projectId) {
              const raw = input.projectId.trim();
              const projMatch = raw.match(/PROJ[-\s]?(\d{2,})/i);
              const bareNum = raw.match(/^(\d{3,7})$/); // bare project number

              if (/^\d{8,}$/.test(raw)) {
                // Long numeric → treat as a raw HubSpot deal ID; fetch its name.
                try {
                  const d = await hubspotClient.crm.deals.basicApi.getById(raw, [
                    "dealname",
                  ]);
                  dealId = raw;
                  dealName = d.properties?.dealname ?? undefined;
                } catch {
                  return JSON.stringify({
                    created: false,
                    message: `I couldn't find a deal with ID ${raw} — double-check the project and try again.`,
                  });
                }
              } else if (projMatch || bareNum) {
                // PROJ number (explicit "PROJ-1234" or a bare project number).
                // Exact-match the token (word boundary) so PROJ-123 ≠ PROJ-1234.
                const digits = (projMatch?.[1] ?? bareNum?.[1])!;
                const token = `PROJ-${digits}`;
                const res = await searchWithRetry({
                  query: token,
                  limit: 20,
                  properties: ["dealname"],
                });
                const boundary = new RegExp(`(^|[^0-9])PROJ-${digits}([^0-9]|$)`, "i");
                const matches = Array.from(
                  new Map(
                    (res.results ?? [])
                      .filter((r) => boundary.test(r.properties?.dealname ?? ""))
                      .map((r) => [r.id, r])
                  ).values()
                );
                if (matches.length === 0) {
                  return JSON.stringify({
                    created: false,
                    message: `I couldn't find a deal for ${token}. Want me to create the task without attaching it to a project, or can you double-check the number?`,
                  });
                }
                if (matches.length > 1) {
                  return JSON.stringify({
                    created: false,
                    needsClarification: true,
                    message: `I found ${matches.length} deals matching ${token} — which one should the task go on?`,
                    candidates: matches.slice(0, 5).map((m) => ({
                      dealId: m.id,
                      name: m.properties?.dealname,
                    })),
                  });
                }
                dealId = matches[0].id;
                dealName = matches[0].properties?.dealname ?? undefined;
              } else {
                // Customer name or address → full-text deal search. Fuzzier than
                // a PROJ number, so be strict: exactly one match or ask which one
                // (showing names so the user can pick).
                const res = await searchWithRetry({
                  query: raw,
                  limit: 20,
                  properties: ["dealname"],
                });
                const matches = Array.from(
                  new Map((res.results ?? []).map((r) => [r.id, r])).values()
                );
                if (matches.length === 0) {
                  return JSON.stringify({
                    created: false,
                    message: `I couldn't find a deal matching "${raw}". Want me to create the task without attaching it to a project, or can you give me the PROJ number?`,
                  });
                }
                if (matches.length > 1) {
                  return JSON.stringify({
                    created: false,
                    needsClarification: true,
                    message: `"${raw}" matches ${matches.length} deals — which one should the task go on?`,
                    candidates: matches.slice(0, 6).map((m) => ({
                      dealId: m.id,
                      name: m.properties?.dealname,
                    })),
                  });
                }
                dealId = matches[0].id;
                dealName = matches[0].properties?.dealname ?? undefined;
              }
            }

            // Resolve the requester's HubSpot owner id. Uses the shared
            // resolver, which lists all owners (the ?email= filter returns
            // nothing in our tenant) and falls back to a first.last@domain
            // heuristic from the display name — handling Google Workspace
            // aliases like zach@ → zach.rosen@.
            let ownerId: string | undefined;
            try {
              const { resolveOwnerIdByEmail } = await import("@/lib/hubspot-tasks");
              ownerId = (await resolveOwnerIdByEmail(senderEmail, senderName)) ?? undefined;
            } catch {
              // non-fatal — create unassigned
            }

            // Due timestamp: now + dueInDays (default 1)
            const dueMs =
              Date.now() + (input.dueInDays ?? 1) * 24 * 60 * 60 * 1000;

            const properties: Record<string, string> = {
              hs_task_subject: input.subject.slice(0, 500),
              hs_task_body: (input.body ?? "").slice(0, 65535),
              hs_task_status: "NOT_STARTED",
              hs_task_priority: "MEDIUM",
              hs_task_type: "TODO",
              hs_timestamp: String(dueMs),
            };
            if (ownerId) properties.hubspot_owner_id = ownerId;

            const body: Record<string, unknown> = { properties };
            // HubSpot standard association type id: deal -> task
            if (dealId) {
              body.associations = [
                {
                  to: { id: dealId },
                  types: [
                    {
                      associationCategory: "HUBSPOT_DEFINED",
                      associationTypeId: 216,
                    },
                  ],
                },
              ];
            }

            const res = await fetch(
              "https://api.hubapi.com/crm/v3/objects/tasks",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
              }
            );

            if (!res.ok) {
              const errText = await res.text().catch(() => "");
              console.error(
                `[tech-ops-bot] create task failed: ${res.status} ${errText.slice(0, 200)}`
              );
              return JSON.stringify({
                created: false,
                message:
                  "I couldn't create that task — HubSpot rejected the request. Try again or create it manually.",
              });
            }

            const data = (await res.json()) as { id: string };
            return JSON.stringify({
              created: true,
              taskId: data.id,
              subject: input.subject,
              dueInDays: input.dueInDays ?? 1,
              assignedTo: ownerId ? senderEmail : "unassigned",
              attachedTo: dealName ?? (dealId ? `deal ${dealId}` : "no project (standalone task)"),
              message:
                "Task created in HubSpot. Read back the subject and the project/deal name so they can confirm it's on the right record.",
            });
          } catch (err) {
            console.error("[tech-ops-bot] create_hubspot_task error:", err);
            return JSON.stringify({
              created: false,
              message: "Something went wrong creating that task.",
            });
          }
        },
      };
    }
    return tool;
  });

  // ── Wrap all tools to track usage ──
  // toolRunner returns only the final text message — intermediate tool_use
  // blocks are internal. We track usage by wrapping each tool's run function.
  const toolsUsedSet = new Set<string>();
  const allTools = [...readOnlyTools, ...botTools].map((tool) => ({
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
      prisma.techOpsBotConversation.create({
        data: {
          spaceId: spaceName,
          threadId: threadName,
          senderEmail,
          senderName,
          role: "user",
          content: messageText,
        },
      }),
      prisma.techOpsBotConversation.create({
        data: {
          spaceId: spaceName,
          threadId: threadName,
          senderEmail: "bot",
          senderName: "Zach's Assistant",
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
    `[tech-ops-bot] posting reply to ${spaceName} (len=${responseText.length}, tools=${toolsUsed.join(",")})`
  );
  await postGoogleChatMessage({
    spaceName,
    text: responseText || "I processed your message but didn't have anything to say. Try asking a specific question?",
  });
  console.warn(`[tech-ops-bot] reply posted to ${spaceName}`);
}
