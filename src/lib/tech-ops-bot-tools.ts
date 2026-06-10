/**
 * Tech Ops Bot Tool Definitions
 *
 * Tools specific to the assistant bot that aren't in the standard chat
 * tools. Tools are READ-ONLY except `escalate` (writes TechOpsBotEscalation)
 * and `submit_process_request` (writes BugReport) — both handled by the
 * orchestrator wrapper in tech-ops-bot.ts, not here.
 *
 * Uses betaZodTool (same pattern as chat-tools.ts).
 */

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export function createTechOpsBotTools() {
  const getProjectStatus = betaZodTool({
    name: "get_project_status",
    description:
      "Get combined status for a project: deal properties, Zuper job status, " +
      "and BOM snapshot. Accepts PROJ-XXXX format or a HubSpot deal ID.",
    inputSchema: z.object({
      projectId: z
        .string()
        .describe("PROJ-XXXX number or HubSpot deal ID"),
    }),
    run: async (input) => {
      const { hubspotClient, searchWithRetry } = await import("@/lib/hubspot");

      // Resolve deal ID from PROJ-XXXX if needed
      let dealId = input.projectId;
      if (input.projectId.startsWith("PROJ-")) {
        const searchResult = await searchWithRetry({
          query: input.projectId,
          limit: 1,
          properties: ["dealname"],
          sorts: ["createdate"],
        });
        if (!searchResult.results.length) {
          return JSON.stringify({ error: `No deal found for ${input.projectId}` });
        }
        dealId = searchResult.results[0].id;
      }

      // Fetch deal properties
      const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
        "dealname", "dealstage", "amount", "pb_location",
        "design_status", "permitting_status", "site_survey_status",
        "install_date", "inspection_date", "pto_date",
        "system_size_kw", "module_type", "inverter_type",
        "battery_type", "battery_count",
      ]);

      // Check for Zuper job
      const { prisma } = await import("@/lib/db");
      let zuperStatus: string | null = null;
      if (prisma) {
        const jobCache = await prisma.zuperJobCache.findFirst({
          where: { hubspotDealId: dealId },
          select: { jobStatus: true, jobUid: true },
        });
        zuperStatus = jobCache?.jobStatus ?? null;
      }

      // Check for BOM snapshot
      let bomStatus: { version: number; itemCount: number; pushedToHubSpot: boolean } | null = null;
      if (prisma) {
        const snapshot = await prisma.projectBomSnapshot.findFirst({
          where: { dealId },
          orderBy: { version: "desc" },
          select: { version: true, bomData: true },
        });
        if (snapshot) {
          const pushLog = await prisma.bomHubSpotPushLog.findFirst({
            where: { dealId, status: "SUCCESS" },
            orderBy: { createdAt: "desc" },
          });
          const bomData = snapshot.bomData as Record<string, unknown> | null;
          const items = Array.isArray(bomData?.items) ? bomData.items : [];
          bomStatus = {
            version: snapshot.version,
            itemCount: items.length,
            pushedToHubSpot: !!pushLog,
          };
        }
      }

      return JSON.stringify({
        dealId,
        properties: deal.properties,
        zuper: zuperStatus ? { status: zuperStatus } : null,
        bom: bomStatus,
      });
    },
  });

  const getScheduleOverview = betaZodTool({
    name: "get_schedule_overview",
    description:
      "Get upcoming installs and surveys for the next N days, optionally filtered by location. " +
      "Reads from all location-specific Google Calendars.",
    inputSchema: z.object({
      location: z
        .string()
        .optional()
        .describe(
          "Filter by location: westminster, centennial, cosp, california, camarillo. Omit for all."
        ),
      days: z
        .number()
        .optional()
        .default(7)
        .describe("How many days ahead to look (default 7)"),
    }),
    run: async (input) => {
      // Calendar IDs by location bucket
      const calendarMap: Record<string, string | undefined> = {
        westminster: process.env.GOOGLE_INSTALL_CALENDAR_WESTY_ID,
        westy: process.env.GOOGLE_INSTALL_CALENDAR_WESTY_ID,
        centennial: process.env.GOOGLE_INSTALL_CALENDAR_DTC_ID,
        dtc: process.env.GOOGLE_INSTALL_CALENDAR_DTC_ID,
        cosp: process.env.GOOGLE_INSTALL_CALENDAR_COSP_ID,
        colorado_springs: process.env.GOOGLE_INSTALL_CALENDAR_COSP_ID,
        california: process.env.GOOGLE_INSTALL_CALENDAR_CA_ID,
        slo: process.env.GOOGLE_INSTALL_CALENDAR_CA_ID,
        camarillo: process.env.GOOGLE_INSTALL_CALENDAR_CAMARILLO_ID,
      };

      // Determine which calendars to query
      let calendarIds: string[];
      if (input.location) {
        const normalized = input.location.toLowerCase().replace(/\s+/g, "_");
        const id = calendarMap[normalized];
        if (!id) {
          return JSON.stringify({
            error: `Unknown location: ${input.location}`,
            knownLocations: ["westminster", "centennial", "cosp", "california", "camarillo"],
          });
        }
        calendarIds = [id];
      } else {
        calendarIds = [...new Set(Object.values(calendarMap).filter(Boolean))] as string[];
      }

      if (!calendarIds.length) {
        return JSON.stringify({ error: "No calendars configured" });
      }

      // v1: Direct calendar reads require the calendar.events scope, which
      // the Chat API service account token doesn't have. Rather than adding
      // a second token flow, point users to the scheduler dashboard.
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + (input.days ?? 7));

      return JSON.stringify({
        range: { from: now.toISOString(), to: endDate.toISOString() },
        locations: input.location ? [input.location] : ["all"],
        note: "For detailed schedule, check pbtechops.com/dashboards/scheduler. " +
              "Calendar read integration is a future enhancement.",
      });
    },
  });

  const getServiceQueue = betaZodTool({
    name: "get_service_queue",
    description:
      "Get the top 10 service priority queue items with scores and tiers. " +
      "Shows what's critical, high, medium, and low priority in the service pipeline.",
    inputSchema: z.object({}),
    run: async () => {
      try {
        // Hit the existing priority-queue API endpoint internally.
        const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
        const apiToken = process.env.API_SECRET_TOKEN;
        const resp = await fetch(`${baseUrl}/api/service/priority-queue`, {
          headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        });

        if (!resp.ok) {
          return JSON.stringify({
            error: `Service queue API returned ${resp.status}`,
            note: "Check pbtechops.com/dashboards/service-overview for current queue",
          });
        }

        const data = await resp.json();
        const queue = data.queue ?? [];

        // Top 10 by score (API returns sorted)
        const top10 = queue.slice(0, 10).map((item: Record<string, unknown>) => ({
          dealId: item.dealId,
          dealName: item.dealName,
          score: item.score,
          tier: item.tier,
          location: item.location,
          topReasons: ((item.reasons as string[]) ?? []).slice(0, 2),
        }));

        return JSON.stringify({
          total: queue.length,
          top10,
          summary: data.summary ?? {},
        });
      } catch (err) {
        return JSON.stringify({
          error: `Service queue unavailable: ${err instanceof Error ? err.message : "unknown"}`,
          note: "Check pbtechops.com/dashboards/service-overview for current queue",
        });
      }
    },
  });

  const escalate = betaZodTool({
    name: "escalate",
    description:
      "Flag a question that you can't confidently answer for Zach to follow up on. " +
      "Use this when the question requires judgment, approval, or information you don't have.",
    inputSchema: z.object({
      question: z.string().describe("The original question from the user"),
      context: z
        .string()
        .describe("What you know about this question and why you're escalating"),
    }),
    run: async (_input) => {
      // NOTE: The orchestrator in tech-ops-bot.ts wraps this tool and replaces
      // `run` entirely to inject request context (senderEmail, spaceName,
      // etc.). This default implementation is only hit in unit tests or
      // if someone calls createTechOpsBotTools() standalone.
      // It does NOT write to the DB — the orchestrator wrapper handles that.
      return JSON.stringify({
        escalated: true,
        message: "Flagged for Zach to follow up.",
      });
    },
  });

  const submitProcessRequest = betaZodTool({
    name: "submit_process_request",
    description:
      "File a process request on behalf of the person you're chatting with — a request to add, change, " +
      "or fix a process, workflow, or tool in the suite. ONLY use this when the person EXPLICITLY asks " +
      "you to file/submit/log a request (e.g. \"can you put in a request to…\"). Never file one on your own " +
      "initiative. Read the title back to them so they know what was logged.",
    inputSchema: z.object({
      title: z
        .string()
        .describe("Short one-line summary of the request (max ~200 chars)"),
      description: z
        .string()
        .describe("Full details of what's being requested and why"),
    }),
    run: async (_input) => {
      // NOTE: The orchestrator in tech-ops-bot.ts wraps this tool and replaces
      // `run` entirely to inject request context (senderEmail, senderName,
      // spaceName) and write the BugReport row. This default implementation
      // is only hit in unit tests or standalone use — it does NOT persist.
      return JSON.stringify({
        submitted: true,
        message: "Logged your process request for the team.",
      });
    },
  });

  const searchSop = betaZodTool({
    name: "search_sop",
    description:
      "Search the SOP (Standard Operating Procedures) guides for process documentation. " +
      "Use this for how-to questions about scheduling, pipeline, HubSpot workflows, etc.",
    inputSchema: z.object({
      query: z.string().describe("Topic keyword or question to search for"),
    }),
    run: async (input) => {
      const { prisma } = await import("@/lib/db");
      if (!prisma) {
        return JSON.stringify({ error: "Database not available" });
      }

      // Search SOP sections by title and content (case-insensitive)
      const sections = await prisma.sopSection.findMany({
        where: {
          OR: [
            { title: { contains: input.query, mode: "insensitive" } },
            { content: { contains: input.query, mode: "insensitive" } },
          ],
        },
        include: {
          tab: { select: { label: true } },
        },
        take: 5,
        orderBy: { sortOrder: "asc" },
      });

      if (!sections.length) {
        return JSON.stringify({
          results: [],
          note: `No SOP sections found for "${input.query}". Try different keywords.`,
        });
      }

      // Strip HTML tags and truncate content
      const results = sections.map((s) => ({
        tab: s.tab.label,
        title: s.title,
        content: s.content
          .replace(/<[^>]+>/g, " ")  // Strip HTML
          .replace(/\s+/g, " ")       // Collapse whitespace
          .trim()
          .slice(0, 2000),            // Truncate to 2000 chars
      }));

      return JSON.stringify({ results });
    },
  });

  const createHubspotTask = betaZodTool({
    name: "create_hubspot_task",
    description:
      "Create a HubSpot task on behalf of the person you're chatting with — e.g. " +
      "\"make me a task to follow up on PROJ-1234 next week.\" The task is assigned to " +
      "the requester (resolved from their email) and, if a project is given, attached to " +
      "that deal. You can CREATE tasks only — you cannot edit, complete, or delete them. " +
      "Only use this when the person explicitly asks for a task to be created. Always read " +
      "back exactly what you created (subject, due date, project) so they can confirm.",
    inputSchema: z.object({
      subject: z
        .string()
        .describe("Short task title, e.g. 'Follow up on Miller permit status'"),
      body: z
        .string()
        .optional()
        .describe("Optional task notes / additional detail"),
      projectId: z
        .string()
        .optional()
        .describe("Optional PROJ-XXXX number or HubSpot deal ID to attach the task to"),
      dueInDays: z
        .number()
        .optional()
        .describe("Optional days from now the task is due (e.g. 3 = due in 3 days). Defaults to 1 (tomorrow)."),
    }),
    run: async (_input) => {
      // NOTE: The orchestrator in tech-ops-bot.ts wraps this tool and replaces
      // `run` entirely to inject request context (senderEmail) and perform the
      // actual HubSpot write. This default implementation is only hit in unit
      // tests or standalone use — it does NOT create anything.
      return JSON.stringify({
        created: false,
        message: "Task creation is only available in the live bot context.",
      });
    },
  });

  return [getProjectStatus, getScheduleOverview, getServiceQueue, escalate, searchSop, submitProcessRequest, createHubspotTask];
}
