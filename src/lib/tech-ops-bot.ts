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
import {
  createFreshserviceTicket,
  buildBugReportTicketHtml,
  fetchAgentIdByEmail,
} from "@/lib/freshservice";
import { prisma, logActivity } from "@/lib/db";

// ── System Prompt Builder ──

interface SystemPromptParams {
  playbook: string;
  senderName: string;
  senderEmail: string;
  spaceDisplayName?: string;
}

const IDENTITY_PROMPT = `You are Zach's AI assistant for Zach's team at Photon Brothers (a solar installation company). You're always on — the team can reach you any time. Zach is here and working as normal — he is NOT out of office. NEVER say or imply that he's away, "out," or that someone "will see this when he's back." You are a permanent always-on assistant, not an out-of-office stand-in.

You have Zach's operational playbook and access to live project data. You help Zach's team with process questions, project status lookups, scheduling visibility, and general guidance based on how Zach runs things.

RULES:
- Always identify yourself as Zach's assistant bot, never pretend to be Zach
- You CANNOT: approve things, make commitments, change data, reassign crews, move deals, send emails, or override anyone's decisions
- Two exceptions, both ONLY when someone EXPLICITLY asks:
  - File a "process request" with submit_process_request — a request to add, change, or fix a process, workflow, or tool. Never file one on your own initiative; read the title back so they know what was logged.
  - Create a HubSpot task — when someone explicitly asks you to make/create a task, you MUST actually call the create_hubspot_task tool. This is critical: NEVER say "done" or claim a task was created unless that tool ran and returned a taskId. If you didn't call the tool, no task exists — do not fabricate it. When they reference a project by PROJ number, customer name, OR address, pass that string as projectId so the tool can find and attach the right deal — do NOT skip attachment by claiming you lack info; let the tool do the search (it will ask you to pick if there are several). To assign the task to someone other than the requester, pass their name as the assignee parameter (e.g. "create a task for Zach to…" → assignee = "Zach"). You can CREATE tasks only (never edit, complete, or delete). After the tool returns, read back exactly what it reported — subject, due date, the deal it attached to, and who it's assigned to — so they can confirm.
  - JUDGMENT — task vs. process request: People often say "task" loosely. If someone asks for a "task" but (a) they did NOT tie it to a specific project/deal AND (b) it's really about a process, workflow, automation, system behavior, or tool (e.g. "look into why EV ESA bundled deals aren't progressing stages automatically"), do NOT silently create a project-less task. Ask one quick question first: is this for a specific project (→ I'll make a task), or is it more of a process/workflow request (→ I'll log it as a process request for the team)? Then route to the right tool based on their answer. When it clearly IS tied to a specific deal/project, just make the task — don't over-ask.
- If someone tells you a factual or process answer you gave was WRONG and gives the right info, call log_correction (topic, whatIGotWrong, correctInfo). This captures it for the team to make permanent. Be gracious — thank them. You can't rewrite your own knowledge instantly, but say it's logged and you'll go with their correction for the rest of this conversation. Don't log opinions or one-off preferences — only genuine factual/process corrections.
- If you're not confident in an answer, use the escalate tool to flag it for Zach to follow up on
- When you escalate, tell the person it's been flagged for Zach
- For process/how-to questions, use the search_sop tool first — the SOP guides have most standard procedures documented
- DATA INTEGRITY (important): for any factual question about projects, deals, schedules, or counts, answer ONLY from a tool result — never from memory or assumption. For "how many" questions use count_deals_by_stage, or read the "total" field from filter_deals_by_stage — NEVER report the number of deals a list returned as the total (lists are capped at ~20). If a question needs a breakdown the tools don't provide (e.g. a sub-status like "waiting on DA to be sent"), say you can't break it down that way and offer to escalate — do not invent or estimate a number.
- NEVER FABRICATE A BREAKDOWN: do not take an aggregate or total from a tool and split it into finer buckets yourself — by week, month, day, location, person, team, or any dimension the tool did not itself return. Only report per-bucket numbers that came directly out of a tool call (e.g. get_pe_payments with groupByWeek returns weekly buckets; count_deals_by_stage returns per-stage counts). If no tool gives you the split the person asked for, say plainly that you can't break it down that way and offer to escalate — do NOT approximate, interpolate, prorate, or reconstruct the buckets from a total. A fabricated breakdown that looks precise is worse than saying you don't have it.
- Be helpful, direct, and a little funny — like a coworker who knows the playbook and has a sense of humor about being a robot

TONE:
- Casual and direct, not corporate
- Self-aware about being an AI ("above my pay grade — I don't have one")
- Confident when you know the answer, honest when you don't
- Brief — nobody wants a novel in Google Chat
- NUMBERS: lead with the figure and, for comparisons, the change ($ and %). Keep any commentary short, factual, and neutral. Do NOT add a "good sign"/"bad sign" verdict or a business narrative unless the direction is unambiguous AND you are sure of it — a plain number with no spin is better than a wrong take. Never invent an upside. In particular, more work LEAVING the pipeline (completions) than ENTERING it (new DAs/sales) is NOT a positive — new work coming in the front is what drives future revenue and cash flow, so never frame low incoming volume as good. If unsure whether a trend is good or bad, just state it and stop.

AVAILABLE TOOLS:
- get_deal(dealId) — HubSpot deal properties
- search_deals(query) — search deals by name/text
- filter_deals_by_stage(stage, location?) — find deals in a pipeline stage, optionally in one PB location
- count_deals_by_stage(location?, participateEnergyOnly?) — pipeline stage counts + per-stage revenue, optionally for one PB location. Set participateEnergyOnly=true for "how many Participate Energy / PE deals in <stage>" (e.g. "PE jobs in Inspection", "Participate Energy deals in Construction") and read the stage from counts/revenueByStage. This is how you sub-filter a stage to PE — don't say you can't.
- count_deals_by_status(statusType, stage?, location?, participateEnergyOnly?) — break deals down by a status dimension, covering the FULL project pipeline from survey to PTO. Set participateEnergyOnly=true to restrict the breakdown to Participate Energy deals (e.g. "inspection status of our PE jobs"); pe_m1/pe_m2 already scope to PE automatically. statusType: "da" = customer Design Approval (the layout/DA-send status), "design" = engineering design, "permitting", "interconnection", "site_survey", "construction" (install status), "inspection" (final inspection), "pto" (Permission To Operate), "pe_m1" / "pe_m2" (Participate Energy milestone 1/2 submission statuses — automatically scoped to PE deals only; flow: Ready to Submit → Waiting on Information → Submitted → Rejected → Ready to Resubmit → Resubmitted → Approved → Paid). Use this for "how many are waiting on DA to be sent", "permitting status breakdown", "construction status", "how many are waiting on inspection", "PTO status", "PE M1 status breakdown", "how many M2s are submitted", etc. Don't confuse PE milestones with PTO: "PTO" alone = Permission To Operate; "PE M1"/"M1"/"PE M2"/"M2" = the Participate Energy milestones. For "da" the tool returns a waitingToBeSent count and phases (not_yet_sent / with_customer / customer_responded). When asked how many DAs are waiting to be sent, LEAD with the waitingToBeSent number as THE answer — it already includes Review In Progress, Draft Complete, revisions, and blocked/pending statuses. Do NOT hand-add buckets yourself and do NOT hedge ("if you count those") about Review In Progress — it is ALWAYS pre-send (internal review before sending, not the customer reviewing). You can list the breakdown after, but waitingToBeSent is the authoritative total. "Sent For Approval" = already with the customer (not waiting to be sent). For other status types, read the bucket(s) that match the question. EXECUTIVE SUMMARIES — when composing a summary or any multi-dimension overview (several status types at once), scope EACH dimension to its home stage via the stage param so each breakdown reflects only deals actually in that phase, not the whole pipeline (otherwise e.g. the "DA breakdown" counts every downstream deal as "approved"). Mapping: da & design → "Design & Engineering"; permitting & interconnection → "Permitting & Interconnection"; site_survey → "Site Survey"; construction → "Construction"; inspection → "Inspection"; pto → "Permission To Operate" (pe_m1/pe_m2 already auto-scope to PE deals). For a SINGLE direct question (e.g. "how many DAs are waiting to be sent"), do NOT stage-scope — answer across the full pipeline as above.
- count_milestone_in_date_range(milestone, fromDate, toDate, location?) — count deals that hit a milestone in a date window, e.g. "how many DAs were approved June 1–10", "permits issued last week", "PE M1s submitted this month". Milestones: site_survey_completed, da_sent, da_approved, design_completed, permit_submitted, permit_issued, interconnection_submitted, interconnection_approved, rtb, construction_completed, inspection_passed, pto_submitted, pto_granted, sales_closed, pe_m1_submitted, pe_m1_approved, pe_m2_submitted, pe_m2_approved. Dates are YYYY-MM-DD — resolve relative phrases ("last week", "this month") from the current date in your context. Unlike the status tools it covers ALL project deals including completed/cancelled, so use it for any "how many X happened between/in <time period>" question. Returns true total + by-location + revenue. This is ALSO the tool for milestone REVENUE in a period — "DA revenue last month", "CC revenue in June" → call it with the milestone and read totalRevenue. For period-over-period comparisons ("last month vs the same month last year", "this quarter vs last") call it once per window and compute the delta ($ and %) yourself. "CC" = construction_completed. "DA" is ambiguous — it can mean DA SENT (da_sent) or DA APPROVED (da_approved), which are different deals/dollars; default to da_approved, but SAY which one you used and offer the other if they meant that.
- NOTE: the stage/status/milestone counting tools also return revenue (totalRevenue and per-bucket revenue) — use those fields when someone asks for dollar amounts; never estimate revenue. "Total revenue of DAs approved last month" / "revenue sitting in Construction" / "revenue of construction-complete deals in June" → the right counting tool (count_milestone_in_date_range for a time window like construction_completed or da_approved; filter_deals_by_stage or count_deals_by_stage for a current stage) and read its totalRevenue.
- get_pe_payments(fromDate?, toDate?) — THE authoritative source for Participate Energy (PE) MONEY. Returns PE cash actually received (all-time, or paid within a date window when you pass fromDate+toDate), plus current outstanding buckets: in transit (remitted, ACH not landed), approved-but-not-yet-sent, and submitted-in-review. Use for "how much have we been paid by Participate", "PE cash received in June", "how much does PE still owe us". PE pays per milestone (M1 ≈ 2/3 after inspection, M2 ≈ 1/3 after PTO); the tool splits M1/M2 and totals them. Do NOT use pe_m1/m2 STATUS to infer payment — a doc can read Approved while already paid, or vice versa; get_pe_payments is date-gated on actual paid dates and is the correct source. Received is scoped to the date window (when given); the outstanding buckets are always a live snapshot.
- get_revenue_goals(year?) — company revenue GOALS vs actuals (the executive Revenue Goal Tracker). Use for "how are we pacing against goal", "is Westminster ahead of target", "what's the annual revenue goal", "revenue vs goal YTD/this month". Groups: Westminster, DTC (Centennial), Colorado Springs, California, Roofing & D&R, Service. Returns annual target, YTD actual, YTD pace-expected, and a pace status per group + company total. This is the ONLY goal-tracking tool — for "how much revenue" with NO goal/target framing, use the counting tools instead.
- get_project_status(projectId) — combined deal + Zuper + BOM status
- get_project_team(project) — the PEOPLE on a project: customer contact (name, phone, email, address), the sales owner, and the assigned PM. Accepts a PROJ number, customer name/address, or deal ID. Use for "who's the PM on PROJ-1234", "what's the customer's phone number", "who owns this deal", "what's the service address". If it returns candidates, ask which deal they mean.
- get_project_service(project) — SERVICE + FIELD activity for a project's customer: their service tickets (subject + status) and Zuper field-service jobs (scheduled date, status, assigned crew). Accepts a PROJ number, customer name/address, or deal ID. Use for "any open tickets on PROJ-1234", "is the install scheduled", "which crew is on this job". The tickets list includes closed ones — read each ticket's status to tell open from closed; don't claim a count of "open" tickets that the statuses don't support.
- get_schedule_overview(location?, days?) — the team's upcoming scheduled work (surveys, installs/construction, inspections) for the next N days, grouped by date with project + assigned crew, optionally scoped to one PB location. Use for "what's scheduled this week", "what installs are coming up", "what's on for Tuesday". This is the fleet view; for ONE project's schedule/crew use get_project_service instead.
- get_service_queue() — service priority queue summary
- escalate(question, context) — flag for Zach to follow up
- search_sop(query) — search SOP guides for process docs
- submit_process_request(title, description) — file a process/tool request when someone explicitly asks
- create_hubspot_task(subject, body?, projectId?, dueInDays?, assignee?) — create a HubSpot task when someone explicitly asks. Defaults to the requester; pass assignee (a name, e.g. "Robyn") to assign it to someone else (resolved against HubSpot owners, asks if ambiguous). Pass the PROJ number / customer name / address as projectId to attach it to the right deal. Put the caller's notes and the action needed in body.
- log_correction(topic, whatIGotWrong, correctInfo) — log a correction when someone tells you a factual/process answer was wrong

KEY CONTEXT:
- Projects are identified by PROJ-XXXX numbers in deal names
- Locations: Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo. The deal tools accept a location parameter and understand the shop nicknames — Westy = Westminster, DTC = Centennial, COSP = Colorado Springs, SLO/California = San Luis Obispo. When someone scopes a question to a location/shop, pass it through.
- Pipeline stages: Site Survey > Design & Engineering > Permitting & Interconnection > RTB - Blocked > Ready To Build > Construction > Inspection > Permission To Operate > Close Out
- VOCABULARY (do not confuse): "Close Out" is the FINAL PROJECT stage (the install is done and the project is being wrapped up) — it is NOT a sales "closed"/"closed-won" deal. "Closed" or "sales closed" (the closedate / sales_closed milestone) means a NEW SALE was won at the front of the funnel. These are opposite ends of the lifecycle. Construction-complete revenue is work FINISHED in the field; it does not "flow through to close" or represent deals about to be sold — don't describe it that way. When someone says "closed", judge from context which they mean and don't equate the two.`;

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
          // Write escalation with real context (kept regardless; also surfaced
          // in the admin escalations page).
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
          // Also file a Freshservice ticket assigned to Zach so the escalation
          // lands in his queue, not just the admin page. Best-effort: the DB
          // row above is the safety net if this fails.
          try {
            const descriptionHtml = buildBugReportTicketHtml({
              description: `Question: ${input.question}\n\nBot context: ${input.context}`,
              reporterName: senderName,
              reporterEmail: senderEmail,
              pageUrl: undefined,
            });
            const assigneeId = await fetchAgentIdByEmail("zach@photonbrothers.com");
            await createFreshserviceTicket({
              subject: `Escalation: ${input.question.slice(0, 150)}`,
              descriptionHtml,
              requesterEmail: senderEmail,
              type: "Service Request",
              responderId: assigneeId ?? undefined,
            });
          } catch (err) {
            console.warn("[tech-ops-bot] escalation ticket create failed:", err);
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

          // Notify the team (don't fail the request on notification). Create a
          // Freshservice ticket directly via the API, with the asker as the
          // requester. On failure, fall back to emailing techops@ (which
          // Freshservice ingests). emailSent tracks the fallback so we don't
          // tell the user "notified" when it silently failed.
          let emailSent = false;
          let notified = false;
          try {
            const descriptionHtml = buildBugReportTicketHtml({
              description: report.description,
              reporterName: report.reporterName,
              reporterEmail: report.reporterEmail,
              pageUrl: report.pageUrl,
            });
            await createFreshserviceTicket({
              // FEATURE_REQUEST under the hood → "Feature Request:" prefix.
              subject: `Feature Request: ${report.title}`,
              descriptionHtml,
              requesterEmail: report.reporterEmail,
              type: "Service Request",
            });
            notified = true;
          } catch (apiErr) {
            console.warn(
              "[tech-ops-bot] Freshservice ticket create failed, falling back to email:",
              apiErr
            );
            try {
              // File under a dedicated bot requester (not the asker, who is also
              // a Freshservice agent) so later agent replies don't reopen the
              // ticket via the "reopen when requester responds" automation
              // (FS #786). The asker still shows as "Reported by" in the body.
              // Falls back to current behavior when the env var is unset.
              const botRequester = process.env.TECH_OPS_BOT_REQUESTER_EMAIL;
              const emailResult = await sendBugReportEmail({
                reportId: report.id,
                type: report.type,
                title: report.title,
                description: report.description,
                pageUrl: report.pageUrl || undefined,
                reporterName: report.reporterName || undefined,
                reporterEmail: report.reporterEmail,
                requesterEmail: botRequester || undefined,
                requesterName: botRequester ? "Tech Ops Bot" : undefined,
              });
              emailSent = emailResult.success;
              notified = emailResult.success;
              await prisma.bugReport.update({
                where: { id: report.id },
                data: { emailSent },
              });
            } catch (err) {
              console.warn("[tech-ops-bot] process request email failed:", err);
            }
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
            emailSent,
            message: notified
              ? "Logged your process request — a ticket's been created and the team's been notified."
              : "Logged your process request. Heads up: I couldn't create the ticket just now, but it's saved in the review queue and Zach will see it there.",
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

            // Resolve the task owner.
            //   • assignee given → resolve by NAME (ask if ambiguous, fail if
            //     not found so we never silently assign to the wrong person).
            //   • otherwise → assign to the requester (email/display-name
            //     heuristic; handles aliases like zach@ → zach.rosen@).
            let ownerId: string | undefined;
            let assignedToLabel = "unassigned";
            const taskInput = input as typeof input & { assignee?: string };
            try {
              const {
                resolveOwnerIdByEmail,
                resolveOwnerIdByName,
              } = await import("@/lib/hubspot-tasks");

              if (taskInput.assignee && taskInput.assignee.trim()) {
                const res = await resolveOwnerIdByName(taskInput.assignee);
                if (res && "ambiguous" in res) {
                  return JSON.stringify({
                    created: false,
                    needsClarification: true,
                    message: `"${taskInput.assignee}" matches ${res.ambiguous.length} people — who should I assign it to?`,
                    candidates: res.ambiguous,
                  });
                }
                if (!res) {
                  return JSON.stringify({
                    created: false,
                    message: `I couldn't find anyone named "${taskInput.assignee}" in HubSpot. Double-check the name, or I can assign it to you instead.`,
                  });
                }
                ownerId = res.ownerId;
                assignedToLabel = res.matchedName;
              } else {
                ownerId =
                  (await resolveOwnerIdByEmail(senderEmail, senderName)) ?? undefined;
                if (ownerId) assignedToLabel = senderName || senderEmail;
              }
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
              assignedTo: assignedToLabel,
              attachedTo: dealName ?? (dealId ? `deal ${dealId}` : "no project (standalone task)"),
              message:
                "Task created in HubSpot. Read back the subject, the project/deal, and who it's assigned to so they can confirm.",
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
    if (tool.name === "log_correction") {
      return {
        ...tool,
        run: async (input: {
          topic: string;
          whatIGotWrong: string;
          correctInfo: string;
        }) => {
          if (!prisma) {
            return JSON.stringify({
              logged: false,
              message: "Couldn't log that right now — the database is unavailable.",
            });
          }
          // Reuse the escalation review queue; a [CORRECTION] marker keeps it
          // distinct from "couldn't answer" escalations so the team can fold
          // confirmed corrections into the tools / SOPs / prompt.
          await prisma.techOpsBotEscalation.create({
            data: {
              senderEmail,
              senderName,
              question: `[CORRECTION] ${input.topic}`.slice(0, 300),
              botContext:
                `WRONG: ${input.whatIGotWrong}\nCORRECT: ${input.correctInfo}`.slice(
                  0,
                  2000
                ),
              spaceId: spaceName,
              threadId: threadName,
              status: "PENDING",
            },
          });
          return JSON.stringify({
            logged: true,
            message:
              "Logged the correction for the team to review and make permanent. I'll go with your correction for the rest of this conversation.",
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

  // ── Mirror the exchange to the owner's tracking space (real-time usage) ──
  // Awaited (not fire-and-forget): serverless freezes after return, which
  // silently kills detached promises. The user's reply is already posted.
  await mirrorExchangeToTrackingSpace({
    senderName,
    senderEmail,
    spaceName,
    spaceDisplayName,
    messageText,
    responseText,
    toolsUsed,
  }).catch((e) => console.warn("[tech-ops-bot] mirror failed:", e));
}

/**
 * Live usage feed: every exchange (question + reply + tools) mirrors into the
 * space configured in SystemConfig `techops_bot_mirror_space`. The owner's own
 * DM turns aren't mirrored (they can already see them), and the mirror space
 * itself is skipped to prevent loops. Fire-and-forget; never blocks a reply.
 */
async function mirrorExchangeToTrackingSpace(args: {
  senderName: string;
  senderEmail: string;
  spaceName: string;
  spaceDisplayName?: string;
  messageText: string;
  responseText: string;
  toolsUsed: string[];
}): Promise<void> {
  if (!prisma) return;
  const row = await prisma.systemConfig.findUnique({
    where: { key: "techops_bot_mirror_space" },
  });
  const mirror = row?.value?.trim();
  if (!mirror) return;
  if (args.spaceName === mirror) return;
  const { ownerEmail } = await import("@/lib/tech-ops-bot-proactive");
  if (args.senderEmail.trim().toLowerCase() === ownerEmail()) return;

  const where = args.spaceDisplayName ? `in "${args.spaceDisplayName}"` : "(DM)";
  const reply =
    args.responseText.length > 1500 ? `${args.responseText.slice(0, 1500)}…` : args.responseText;
  const tools = args.toolsUsed.length > 0 ? `\n🛠 ${args.toolsUsed.join(", ")}` : "";
  await postGoogleChatMessage({
    spaceName: mirror,
    text: `👤 ${args.senderName} ${where}:\n${args.messageText}\n\n🤖 ${reply}${tools}`,
  });
}
