/**
 * Sync Tasks — Pull from Freshservice & HubSpot into TASKS.md, two-way status sync.
 *
 * Usage:
 *   npx tsx scripts/sync-tasks.ts                   # full sync (pull + push)
 *   npx tsx scripts/sync-tasks.ts --dry-run          # preview changes only
 *   npx tsx scripts/sync-tasks.ts --direction pull    # only pull new tasks
 *   npx tsx scripts/sync-tasks.ts --direction push    # only push status changes
 *   npx tsx scripts/sync-tasks.ts --direction both    # pull + push (default)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" }); // fallback — loads vars not already set

import * as fs from "fs";
import * as path from "path";

// ─── Config ─────────────────────────────────────────────────────────────

const FRESHSERVICE_API_KEY = process.env.FRESHSERVICE_API_KEY;
const FRESHSERVICE_DOMAIN = process.env.FRESHSERVICE_DOMAIN || "photonbrothers";
const FRESHSERVICE_BASE = `https://${FRESHSERVICE_DOMAIN}.freshservice.com`;

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_PORTAL_ID = "21710069";
const ZACH_OWNER_ID = "2068088473";

const TASKS_PATH = path.resolve(__dirname, "../TASKS.md");

// ─── CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const dirIdx = args.indexOf("--direction");
const DIRECTION: "pull" | "push" | "both" =
  dirIdx >= 0 && args[dirIdx + 1]
    ? (args[dirIdx + 1] as "pull" | "push" | "both")
    : "both";

// ─── Helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "no date";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "no date";
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "America/Denver" });
  const day = d.toLocaleString("en-US", { day: "numeric", timeZone: "America/Denver" });
  const year = d.getFullYear();
  const now = new Date();
  // Show year if it's not the current year
  if (year !== now.getFullYear()) {
    const shortYear = `'${String(year).slice(2)}`;
    return `${month} ${day} ${shortYear}`;
  }
  return `${month} ${day}`;
}

function isOverdue(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  // Compare date-only in Denver timezone
  const dStr = d.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const nowStr = now.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  return dStr < nowStr;
}

// ─── Freshservice API ───────────────────────────────────────────────────

interface FreshserviceTicket {
  id: number;
  subject: string;
  status: number; // 2=Open, 3=Pending, 4=Resolved, 5=Closed
  priority: number; // 1=Low, 2=Medium, 3=High, 4=Urgent
  due_by: string | null;
  requester_id: number;
}

interface FreshserviceRequester {
  id: number;
  first_name: string;
  last_name: string;
}

const FRESHSERVICE_STATUS_MAP: Record<number, string> = {
  2: "Open",
  3: "Pending",
  4: "Resolved",
  5: "Closed",
};

async function freshserviceFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  if (!FRESHSERVICE_API_KEY) throw new Error("FRESHSERVICE_API_KEY not set");

  const auth = Buffer.from(`${FRESHSERVICE_API_KEY}:X`).toString("base64");

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${FRESHSERVICE_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (res.status === 429) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      console.log(`  [Freshservice] Rate limited, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Freshservice ${res.status}: ${text}`);
    }

    return res;
  }
  throw new Error("Freshservice: max retries exceeded");
}

async function fetchOpenTickets(): Promise<FreshserviceTicket[]> {
  // Fetch all tickets with status 2 (Open) — paginate through all pages
  const allTickets: FreshserviceTicket[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await freshserviceFetch(
      `/api/v2/tickets?per_page=${perPage}&page=${page}&order_by=priority&order_type=desc`
    );
    const data = (await res.json()) as { tickets: FreshserviceTicket[] };
    if (!data.tickets || data.tickets.length === 0) break;
    // Filter to open tickets only (status 2)
    allTickets.push(...data.tickets.filter((t) => t.status === 2));
    if (data.tickets.length < perPage) break;
    page++;
  }

  return allTickets;
}

async function fetchPendingResolvedTickets(): Promise<FreshserviceTicket[]> {
  // Fetch all tickets and filter to status 3 (Pending) or 4 (Resolved) client-side.
  // The Freshservice v2 list API only supports predefined filter names, not arbitrary
  // status filters, so we paginate through all non-closed tickets and filter locally.
  const allTickets: FreshserviceTicket[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await freshserviceFetch(
      `/api/v2/tickets?per_page=${perPage}&page=${page}&order_by=created_at&order_type=desc`
    );
    const data = (await res.json()) as { tickets: FreshserviceTicket[] };
    if (!data.tickets || data.tickets.length === 0) break;
    allTickets.push(...data.tickets.filter((t) => t.status === 3 || t.status === 4));
    if (data.tickets.length < perPage) break;
    page++;
  }

  return allTickets;
}

async function fetchTicketStatus(ticketId: number): Promise<number> {
  const res = await freshserviceFetch(`/api/v2/tickets/${ticketId}`);
  const data = (await res.json()) as { ticket: FreshserviceTicket };
  return data.ticket.status;
}

async function closeTicket(ticketId: number): Promise<void> {
  await freshserviceFetch(`/api/v2/tickets/${ticketId}`, {
    method: "PUT",
    body: JSON.stringify({ status: 5 }),
  });
}

// Requester cache
const requesterCache = new Map<number, string>();

async function getRequesterName(requesterId: number): Promise<string> {
  if (requesterCache.has(requesterId)) return requesterCache.get(requesterId)!;

  try {
    const res = await freshserviceFetch(`/api/v2/requesters/${requesterId}`);
    const data = (await res.json()) as { requester: FreshserviceRequester };
    const name = `${data.requester.first_name} ${data.requester.last_name}`.trim();
    requesterCache.set(requesterId, name);
    return name;
  } catch {
    return "Unknown";
  }
}

// ─── HubSpot Task API ───────────────────────────────────────────────────

interface HubSpotTask {
  id: string;
  properties: Record<string, string | null>;
}

interface HubSpotSearchResponse {
  total: number;
  results: HubSpotTask[];
  paging?: { next?: { after?: string } };
}

async function hubspotSearchTasks(body: object): Promise<HubSpotSearchResponse> {
  if (!HUBSPOT_TOKEN) throw new Error("HUBSPOT_ACCESS_TOKEN not set");

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/tasks/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      console.log(`  [HubSpot] Rate limited, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot ${res.status}: ${text}`);
    }

    return (await res.json()) as HubSpotSearchResponse;
  }
  throw new Error("HubSpot: max retries exceeded");
}

async function fetchZachTasks(): Promise<HubSpotTask[]> {
  // Search for NOT COMPLETED tasks mentioning "Zach"
  const allTasks: HubSpotTask[] = [];
  let after: string | undefined = undefined;

  while (true) {
    const body: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hs_task_status",
              operator: "NEQ",
              value: "COMPLETED",
            },
          ],
        },
      ],
      properties: [
        "hs_task_subject",
        "hs_task_status",
        "hs_task_priority",
        "hs_timestamp",
        "hs_task_body",
        "hubspot_owner_id",
      ],
      query: "Zach",
      limit: 100,
      ...(after ? { after } : {}),
    };

    const resp = await hubspotSearchTasks(body);
    allTasks.push(...resp.results);

    if (resp.paging?.next?.after) {
      after = resp.paging.next.after;
    } else {
      break;
    }
  }

  // Filter: only keep tasks where Zach Rosen is specifically mentioned
  // (exclude other Zachs: Zachary Umetani, Zach Capshaw, etc.)
  return allTasks.filter((task) => {
    const body = task.properties.hs_task_body ?? "";
    const subject = task.properties.hs_task_subject ?? "";
    const ownerId = task.properties.hubspot_owner_id ?? "";

    // Direct owner match
    if (ownerId === ZACH_OWNER_ID) return true;

    // Check for Zach Rosen mention in body or subject
    const combined = `${body} ${subject}`.toLowerCase();
    if (combined.includes("zach rosen")) return true;
    if (combined.includes("preconstruction manager: zach")) return true;

    // Check for mention ID in task body (HubSpot @mention format)
    if (body.includes(ZACH_OWNER_ID)) return true;

    // Check for "ZRS" suffix in subject (Zach Rosen's workflow tasks)
    if (/\bZRS\b/.test(subject)) return true;

    return false;
  });
}

// ─── TASKS.md Parsing ───────────────────────────────────────────────────

function extractFreshserviceIds(content: string): Set<number> {
  const ids = new Set<number>();
  const regex = /\[#(\d+)\]\(https:\/\/photonbrothers\.freshservice\.com/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.add(parseInt(match[1], 10));
  }
  return ids;
}

function extractCheckedFreshserviceIds(content: string): number[] {
  const ids: number[] = [];
  const regex = /^- \[x\] \[#(\d+)\]\(https:\/\/photonbrothers\.freshservice\.com/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(parseInt(match[1], 10));
  }
  return ids;
}

function extractUncheckedFreshserviceIds(content: string): number[] {
  const ids: number[] = [];
  const regex = /^- \[ \] \[#(\d+)\]\(https:\/\/photonbrothers\.freshservice\.com/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(parseInt(match[1], 10));
  }
  return ids;
}

function extractHubSpotTaskIds(content: string): Set<string> {
  const ids = new Set<string>();
  const regex = /\(https:\/\/app\.hubspot\.com\/tasks\/\d+\/view\/all\/task\/(\d+)\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

// ─── Formatting ─────────────────────────────────────────────────────────

function formatFreshserviceEntry(ticket: FreshserviceTicket, requesterName: string): string {
  const url = `${FRESHSERVICE_BASE}/a/tickets/${ticket.id}`;
  const dateStr = formatDate(ticket.due_by);
  const overdue = isOverdue(ticket.due_by) ? " (overdue)" : "";
  return `- [ ] [#${ticket.id}](${url}) — ${ticket.subject} (${requesterName}) — due ${dateStr}${overdue}`;
}

function formatHubSpotEntry(task: HubSpotTask): string {
  const subject = task.properties.hs_task_subject ?? "(no subject)";
  const url = `https://app.hubspot.com/tasks/${HUBSPOT_PORTAL_ID}/view/all/task/${task.id}`;
  const dueDate = task.properties.hs_timestamp;
  const dateStr = formatDate(dueDate);
  const overdue = isOverdue(dueDate) ? " (overdue)" : "";
  const priority = task.properties.hs_task_priority;
  const priorityTag = priority === "HIGH" ? " (HIGH)" : "";
  return `- [ ] [${subject}](${url}) — due ${dateStr}${overdue}${priorityTag}`;
}

// ─── Main Sync Logic ────────────────────────────────────────────────────

async function pullFreshservice(
  existingIds: Set<number>
): Promise<{ newEntries: Map<number, string[]>; pendingResolvedEntries: string[]; summary: string[] }> {
  console.log("\n── Pulling Freshservice tickets ──");

  const summary: string[] = [];
  const newEntries = new Map<number, string[]>(); // priority -> lines
  const pendingResolvedEntries: string[] = [];

  try {
    const openTickets = await fetchOpenTickets();
    console.log(`  Found ${openTickets.length} open tickets`);

    // Group by priority
    const byPriority = new Map<number, FreshserviceTicket[]>();
    for (const t of openTickets) {
      if (!byPriority.has(t.priority)) byPriority.set(t.priority, []);
      byPriority.get(t.priority)!.push(t);
    }

    let newCount = 0;
    for (const [priority, tickets] of byPriority) {
      const newLines: string[] = [];
      for (const ticket of tickets) {
        if (existingIds.has(ticket.id)) continue;
        const name = await getRequesterName(ticket.requester_id);
        newLines.push(formatFreshserviceEntry(ticket, name));
        newCount++;
      }
      if (newLines.length > 0) {
        newEntries.set(priority, newLines);
      }
    }

    summary.push(`  Freshservice: ${newCount} new open ticket(s) to add`);

    // Also fetch pending/resolved for the Pending/Resolved section
    const prTickets = await fetchPendingResolvedTickets();
    for (const ticket of prTickets) {
      if (existingIds.has(ticket.id)) continue;
      const name = await getRequesterName(ticket.requester_id);
      const url = `${FRESHSERVICE_BASE}/a/tickets/${ticket.id}`;
      const statusLabel = ticket.status === 3 ? "pending" : "resolved";
      pendingResolvedEntries.push(
        `- [ ] [#${ticket.id}](${url}) — ${ticket.subject} (${name}) — ${statusLabel}`
      );
    }

    if (pendingResolvedEntries.length > 0) {
      summary.push(`  Freshservice: ${pendingResolvedEntries.length} new pending/resolved ticket(s)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Error fetching Freshservice: ${msg}`);
    summary.push(`  Freshservice: ERROR — ${msg}`);
  }

  return { newEntries, pendingResolvedEntries, summary };
}

async function pullHubSpot(
  existingTaskIds: Set<string>
): Promise<{ newEntries: string[]; summary: string[] }> {
  console.log("\n── Pulling HubSpot tasks ──");

  const summary: string[] = [];
  const newEntries: string[] = [];

  try {
    const tasks = await fetchZachTasks();
    console.log(`  Found ${tasks.length} tasks mentioning Zach Rosen`);

    let newCount = 0;
    for (const task of tasks) {
      if (existingTaskIds.has(task.id)) continue;
      newEntries.push(formatHubSpotEntry(task));
      newCount++;
    }

    summary.push(`  HubSpot: ${newCount} new task(s) to add`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Error fetching HubSpot: ${msg}`);
    summary.push(`  HubSpot: ERROR — ${msg}`);
  }

  return { newEntries, summary };
}

async function pushFreshserviceStatus(
  currentContent: string
): Promise<{ updatedContent: string; summary: string[] }> {
  console.log("\n── Syncing Freshservice status (two-way) ──");

  const summary: string[] = [];
  let content = currentContent;

  // 1. Push: checked-off tickets -> close in Freshservice
  const checkedIds = extractCheckedFreshserviceIds(content);
  let closedCount = 0;

  for (const id of checkedIds) {
    try {
      const currentStatus = await fetchTicketStatus(id);
      if (currentStatus !== 5) {
        if (DRY_RUN) {
          console.log(`  [dry-run] Would close ticket #${id} (current status: ${FRESHSERVICE_STATUS_MAP[currentStatus] ?? currentStatus})`);
        } else {
          await closeTicket(id);
          console.log(`  Closed ticket #${id}`);
        }
        closedCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Failed to close ticket #${id}: ${msg}`);
    }
  }

  if (closedCount > 0) {
    summary.push(`  Freshservice push: ${closedCount} ticket(s) ${DRY_RUN ? "would be" : ""} closed`);
  }

  // 2. Pull: tickets that are now closed in Freshservice but unchecked in TASKS.md
  const uncheckedIds = extractUncheckedFreshserviceIds(content);
  let markedDoneCount = 0;

  for (const id of uncheckedIds) {
    try {
      const currentStatus = await fetchTicketStatus(id);
      if (currentStatus === 5) {
        if (DRY_RUN) {
          console.log(`  [dry-run] Would mark ticket #${id} as done in TASKS.md (closed in Freshservice)`);
        } else {
          // Replace "- [ ] [#ID]" with "- [x] [#ID]" in content
          content = content.replace(
            new RegExp(`^(- )\\[ \\]( \\[#${id}\\])`, "m"),
            "$1[x]$2"
          );
          console.log(`  Marked ticket #${id} as done in TASKS.md (closed in Freshservice)`);
        }
        markedDoneCount++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Failed to check status of ticket #${id}: ${msg}`);
    }
  }

  if (markedDoneCount > 0) {
    summary.push(`  Freshservice pull: ${markedDoneCount} ticket(s) ${DRY_RUN ? "would be" : ""} marked done`);
  }

  return { updatedContent: content, summary };
}

function updateOverdueFlags(content: string): string {
  // Update (overdue) flags based on current date
  const lines = content.split("\n");
  const updatedLines = lines.map((line) => {
    // Match Freshservice entries with "due Mon DD" pattern
    const fsMatch = line.match(/^(- \[[ x]\] \[#\d+\].*— due )(\w+ \d+)(.*?)$/);
    if (fsMatch) {
      const prefix = fsMatch[1];
      const dateStr = fsMatch[2];
      const suffix = fsMatch[3];

      // Parse "Mon DD" date — assume current year
      const now = new Date();
      const parsed = new Date(`${dateStr}, ${now.getFullYear()}`);
      if (!isNaN(parsed.getTime())) {
        const overdueNow = isOverdue(parsed.toISOString());
        const cleanSuffix = suffix.replace(/\s*\(overdue\)/g, "");
        return `${prefix}${dateStr}${cleanSuffix}${overdueNow ? " (overdue)" : ""}`;
      }
    }

    // Match HubSpot entries with "due Mon DD" pattern
    const hsMatch = line.match(/^(- \[[ x]\] \[.*\]\(https:\/\/app\.hubspot\.com.*— due )(\w+ \d+)(.*?)$/);
    if (hsMatch) {
      const prefix = hsMatch[1];
      const dateStr = hsMatch[2];
      const suffix = hsMatch[3];

      const now = new Date();
      const parsed = new Date(`${dateStr}, ${now.getFullYear()}`);
      if (!isNaN(parsed.getTime())) {
        const overdueNow = isOverdue(parsed.toISOString());
        const cleanSuffix = suffix.replace(/\s*\(overdue\)/g, "");
        return `${prefix}${dateStr}${cleanSuffix}${overdueNow ? " (overdue)" : ""}`;
      }
    }

    return line;
  });

  return updatedLines.join("\n");
}

function mergeNewEntries(
  content: string,
  freshEntries: Map<number, string[]>,
  freshPendingResolved: string[],
  hubspotEntries: string[]
): string {
  const lines = content.split("\n");
  const result: string[] = [];

  // Priority section headers
  const sectionHeaders: Record<number, string> = {
    4: "## Urgent — Freshservice (Priority 4)",
    3: "## High — Freshservice (Priority 3)",
    2: "## Medium — Freshservice (Priority 2)",
    1: "## Low — Freshservice (Priority 1)",
  };

  let i = 0;
  const consumed = new Set<number>(); // track which line indices we've already processed

  while (i < lines.length) {
    const line = lines[i];
    result.push(line);

    let sectionMatched = false;

    // Check if this is a Freshservice priority section header
    for (const [priority, header] of Object.entries(sectionHeaders)) {
      if (line === header) {
        const newLines = freshEntries.get(Number(priority));
        if (newLines && newLines.length > 0) {
          sectionMatched = true;
          // Find the end of this section
          let j = i + 1;
          while (j < lines.length && !lines[j].startsWith("## ") && !lines[j].startsWith("# ")) {
            j++;
          }
          // Find insertion point: last task line before trailing blanks
          let insertIdx = j;
          while (insertIdx > i + 1 && lines[insertIdx - 1].trim() === "") {
            insertIdx--;
          }
          // Push existing lines up to insertion point
          for (let k = i + 1; k < insertIdx; k++) {
            result.push(lines[k]);
          }
          // Insert new entries
          for (const newLine of newLines) {
            result.push(newLine);
          }
          // Push remaining blank lines
          for (let k = insertIdx; k < j; k++) {
            result.push(lines[k]);
          }
          i = j;
        }
        break;
      }
    }
    if (sectionMatched) continue;

    // Check if this is the Pending/Resolved section
    if (line.startsWith("## Pending/Resolved") && freshPendingResolved.length > 0) {
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith("## ") && !lines[j].startsWith("# ")) {
        j++;
      }
      let insertIdx = j;
      while (insertIdx > i + 1 && lines[insertIdx - 1].trim() === "") {
        insertIdx--;
      }
      for (let k = i + 1; k < insertIdx; k++) {
        result.push(lines[k]);
      }
      for (const newLine of freshPendingResolved) {
        result.push(newLine);
      }
      for (let k = insertIdx; k < j; k++) {
        result.push(lines[k]);
      }
      i = j;
      continue;
    }

    // Check if this is the HubSpot section
    if (line.startsWith("## HubSpot") && hubspotEntries.length > 0) {
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith("## ") && !lines[j].startsWith("# ")) {
        j++;
      }
      let insertIdx = j;
      while (insertIdx > i + 1 && lines[insertIdx - 1].trim() === "") {
        insertIdx--;
      }
      for (let k = i + 1; k < insertIdx; k++) {
        result.push(lines[k]);
      }
      for (const newLine of hubspotEntries) {
        result.push(newLine);
      }
      for (let k = insertIdx; k < j; k++) {
        result.push(lines[k]);
      }
      i = j;
      continue;
    }

    i++;
  }

  return result.join("\n");
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║         TASKS.md Sync Script              ║");
  console.log("╚═══════════════════════════════════════════╝");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  Direction: ${DIRECTION}`);
  console.log(`  Tasks file: ${TASKS_PATH}`);

  // Validate env
  if (!FRESHSERVICE_API_KEY) {
    console.error("\n  ERROR: FRESHSERVICE_API_KEY not set in .env");
    process.exit(1);
  }
  if (!HUBSPOT_TOKEN) {
    console.error("\n  ERROR: HUBSPOT_ACCESS_TOKEN not set in .env");
    process.exit(1);
  }

  // Read current TASKS.md
  let content = fs.readFileSync(TASKS_PATH, "utf-8");
  const existingFreshIds = extractFreshserviceIds(content);
  const existingHubSpotIds = extractHubSpotTaskIds(content);
  console.log(`\n  Existing: ${existingFreshIds.size} Freshservice, ${existingHubSpotIds.size} HubSpot entries`);

  const allSummary: string[] = [];

  // ── Pull new tasks ──────────────────────────────────────────────────

  let freshEntries = new Map<number, string[]>();
  let freshPendingResolved: string[] = [];
  let hubspotEntries: string[] = [];

  if (DIRECTION === "pull" || DIRECTION === "both") {
    const freshResult = await pullFreshservice(existingFreshIds);
    freshEntries = freshResult.newEntries;
    freshPendingResolved = freshResult.pendingResolvedEntries;
    allSummary.push(...freshResult.summary);

    const hsResult = await pullHubSpot(existingHubSpotIds);
    hubspotEntries = hsResult.newEntries;
    allSummary.push(...hsResult.summary);

    // Merge new entries
    const totalNew =
      [...freshEntries.values()].reduce((sum, arr) => sum + arr.length, 0) +
      freshPendingResolved.length +
      hubspotEntries.length;

    if (totalNew > 0) {
      content = mergeNewEntries(content, freshEntries, freshPendingResolved, hubspotEntries);
    }
  }

  // ── Push status changes ─────────────────────────────────────────────

  if (DIRECTION === "push" || DIRECTION === "both") {
    const pushResult = await pushFreshserviceStatus(content);
    content = pushResult.updatedContent;
    allSummary.push(...pushResult.summary);
  }

  // ── Update overdue flags ────────────────────────────────────────────

  content = updateOverdueFlags(content);

  // ── Write changes ───────────────────────────────────────────────────

  const originalContent = fs.readFileSync(TASKS_PATH, "utf-8");
  const hasChanges = content !== originalContent;

  if (hasChanges) {
    if (DRY_RUN) {
      console.log("\n── Dry Run — changes NOT written ──");
    } else {
      fs.writeFileSync(TASKS_PATH, content, "utf-8");
      console.log("\n── TASKS.md updated ──");
    }
  } else {
    console.log("\n── No changes needed ──");
  }

  // ── Summary ─────────────────────────────────────────────────────────

  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║               Summary                     ║");
  console.log("╚═══════════════════════════════════════════╝");
  if (allSummary.length === 0) {
    console.log("  Everything is up to date.");
  } else {
    for (const line of allSummary) {
      console.log(line);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
