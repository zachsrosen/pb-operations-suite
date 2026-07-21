/**
 * First-consult-date stamping.
 *
 * Writes the `first_consult_date` deal property (created 2026-07-20): the
 * earliest consult-titled meeting (title matches /consult/i, not "Canceled:"-
 * prefixed, has a start time) associated with the deal's primary contact.
 * There is no direct deal↔meeting association for Project-pipeline deals —
 * consults happen before the Project deal exists — so the walk is
 * deal → contact → meetings. ~87% of sold deals have a consult (referrals and
 * repeat customers legitimately skip one).
 *
 * Used by the nightly cron (/api/cron/consult-stamp) for new deals and by
 * scripts/backfill-first-consult-date.ts for history.
 */

const HUBSPOT_BASE = "https://api.hubapi.com";
const PROJECT_PIPELINE = "6900017";

interface StampResult {
  examined: number;
  stamped: number;
  noContact: number;
  noConsult: number;
  errors: number;
}

async function hubspotFetch(path: string, body?: unknown, attempt = 0): Promise<Response> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not configured");
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return hubspotFetch(path, body, attempt + 1);
  }
  return res;
}

/** Deal IDs in the Project pipeline missing first_consult_date, newest first. */
async function findUnstampedDeals(opts: {
  closedOnOrAfter?: string;
  createdInLastDays?: number;
  max: number;
}): Promise<string[]> {
  const filters: Array<Record<string, unknown>> = [
    { propertyName: "pipeline", operator: "EQ", value: PROJECT_PIPELINE },
    { propertyName: "first_consult_date", operator: "NOT_HAS_PROPERTY" },
  ];
  if (opts.closedOnOrAfter) {
    filters.push({
      propertyName: "closedate",
      operator: "GTE",
      value: String(Date.parse(`${opts.closedOnOrAfter}T00:00:00Z`)),
    });
  }
  if (opts.createdInLastDays) {
    filters.push({
      propertyName: "createdate",
      operator: "GTE",
      value: String(Date.now() - opts.createdInLastDays * 86_400_000),
    });
  }
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const res = await hubspotFetch("/crm/v3/objects/deals/search", {
      filterGroups: [{ filters }],
      properties: ["closedate"],
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      limit: 100,
      after,
    });
    if (!res.ok) throw new Error(`deal search ${res.status}`);
    const body = (await res.json()) as {
      results: Array<{ id: string }>;
      paging?: { next?: { after: string } };
    };
    ids.push(...body.results.map((r) => r.id));
    after = body.paging?.next?.after;
  } while (after && ids.length < opts.max);
  return ids.slice(0, opts.max);
}

async function batchAssociations(
  fromType: string,
  toType: string,
  ids: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await hubspotFetch(`/crm/v4/associations/${fromType}/${toType}/batch/read`, {
      inputs: ids.slice(i, i + 100).map((id) => ({ id })),
    });
    if (!res.ok) throw new Error(`${fromType}→${toType} associations ${res.status}`);
    const body = (await res.json()) as {
      results: Array<{ from: { id: string }; to: Array<{ toObjectId: number }> }>;
    };
    for (const a of body.results) {
      out.set(a.from.id, a.to.map((t) => String(t.toObjectId)));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

/** Stamp first_consult_date on Project-pipeline deals that are missing it. */
export async function stampFirstConsultDates(opts: {
  closedOnOrAfter?: string;
  createdInLastDays?: number;
  max?: number;
  dryRun?: boolean;
}): Promise<StampResult> {
  const result: StampResult = { examined: 0, stamped: 0, noContact: 0, noConsult: 0, errors: 0 };
  const dealIds = await findUnstampedDeals({
    closedOnOrAfter: opts.closedOnOrAfter,
    createdInLastDays: opts.createdInLastDays,
    max: opts.max ?? 500,
  });
  result.examined = dealIds.length;
  if (!dealIds.length) return result;

  const contactsByDeal = await batchAssociations("deals", "contacts", dealIds);
  const contactIds = [
    ...new Set([...contactsByDeal.values()].map((c) => c[0]).filter(Boolean)),
  ];
  const meetingsByContact = await batchAssociations("contacts", "meetings", contactIds);
  const meetingIds = [...new Set([...meetingsByContact.values()].flat())];

  const meetings = new Map<string, { title: string; start: string | null }>();
  for (let i = 0; i < meetingIds.length; i += 100) {
    const res = await hubspotFetch("/crm/v3/objects/meetings/batch/read", {
      inputs: meetingIds.slice(i, i + 100).map((id) => ({ id })),
      properties: ["hs_meeting_title", "hs_meeting_start_time"],
    });
    if (!res.ok) throw new Error(`meetings batch read ${res.status}`);
    const body = (await res.json()) as {
      results: Array<{ id: string; properties: { hs_meeting_title: string | null; hs_meeting_start_time: string | null } }>;
    };
    for (const m of body.results) {
      meetings.set(m.id, {
        title: m.properties.hs_meeting_title ?? "",
        start: m.properties.hs_meeting_start_time,
      });
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const updates: Array<{ id: string; properties: { first_consult_date: string } }> = [];
  for (const dealId of dealIds) {
    const contactId = contactsByDeal.get(dealId)?.[0];
    if (!contactId) {
      result.noContact++;
      continue;
    }
    const consults = (meetingsByContact.get(contactId) ?? [])
      .map((id) => meetings.get(id))
      .filter(
        (m): m is { title: string; start: string } =>
          !!m && !!m.start && /consult/i.test(m.title) && !/^canceled/i.test(m.title)
      );
    if (!consults.length) {
      result.noConsult++;
      continue;
    }
    const first = consults.reduce((a, b) => (a.start < b.start ? a : b));
    updates.push({
      id: dealId,
      // HubSpot date properties want midnight-UTC dates.
      properties: { first_consult_date: first.start.slice(0, 10) },
    });
  }

  if (opts.dryRun) {
    result.stamped = updates.length;
    return result;
  }
  for (let i = 0; i < updates.length; i += 100) {
    const res = await hubspotFetch("/crm/v3/objects/deals/batch/update", {
      inputs: updates.slice(i, i + 100),
    });
    if (!res.ok) {
      result.errors += Math.min(100, updates.length - i);
      console.error(`[consult-stamp] batch update failed: ${res.status}`, (await res.text()).slice(0, 300));
      continue;
    }
    result.stamped += Math.min(100, updates.length - i);
    await new Promise((r) => setTimeout(r, 250));
  }
  return result;
}
