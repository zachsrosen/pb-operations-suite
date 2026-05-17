/**
 * PandaDoc API client (read-only).
 *
 * Backup integration for the HubSpot↔PandaDoc native connector. We poll
 * recently-modified DA documents and detect drift between PandaDoc status
 * and HubSpot `layout_status`. Flag-only — no writes back to PandaDoc.
 *
 * Auth: API-Key header (production key in `PANDADOC_API_KEY`).
 * Rate limit: 100 req/min on the documents list endpoint; 429 retried
 * with exponential backoff matching the hubspot.ts pattern.
 */

const PANDADOC_BASE = "https://api.pandadoc.com/public/v1";

// The single canonical Design Approval template.
// Verified via /public/v1/templates?q=Design+Approval — only one template
// uses the [Client.LastName]/[Deal.AddressLine1] placeholder pattern.
export const DA_TEMPLATE_ID = "SfYdCbqDPnZ52Q7wc3YaF4";

// PE template patterns for document discovery
export const PE_TEMPLATE_PATTERNS = [
  { key: "attestation", pattern: "PE Installer Attestation" },
  { key: "acceptance", pattern: "PE Customer Certificate of Acceptance" },
  { key: "progress_waiver", pattern: "Progress Lien Waiver" },
  { key: "final_waiver", pattern: "PE Conditional Waiver and Release on Final Payment" },
] as const;

export type PeTemplateKey = (typeof PE_TEMPLATE_PATTERNS)[number]["key"];

export interface PeTemplateStatus {
  key: PeTemplateKey;
  templateId: string | null;
  document: {
    id: string;
    name: string;
    status: string;
    dateCompleted: string | null;
  } | null;
}

export type PandaDocStatus =
  | "document.uploaded"
  | "document.draft"
  | "document.sent"
  | "document.viewed"
  | "document.waiting_approval"
  | "document.approved"
  | "document.rejected"
  | "document.waiting_pay"
  | "document.paid"
  | "document.completed"
  | "document.declined"
  | "document.expired"
  | "document.voided"
  | "document.external_review";

export type PandaDocListItem = {
  id: string;
  name: string;
  status: PandaDocStatus | string;
  date_created: string;
  date_modified: string;
  date_completed: string | null;
  expiration_date: string | null;
  template_id?: string;
  version?: string;
};

export type PandaDocLinkedObject = {
  id: string;
  provider?: string;
  entity_type?: string;
  entity_id?: string;
  children?: { id: string; entity_type?: string; entity_id?: string }[];
};

export type PandaDocField = {
  field_id?: string;
  name?: string;
  type?: string; // "dropdown" | "text" | "signature" | "date" | ...
  value?: string | number | boolean | null;
  merge_field?: string | null;
};

export type PandaDocDocumentDetail = {
  id: string;
  name: string;
  status: PandaDocStatus | string;
  date_created: string;
  date_modified: string;
  date_sent?: string | null;
  date_completed: string | null;
  expiration_date: string | null;
  template?: { id: string; name: string } | null;
  metadata?: Record<string, string | number | null> | null;
  linked_objects?: PandaDocLinkedObject[];
  tokens?: { name: string; value: string }[];
  fields?: PandaDocField[];
};

// Field IDs on the canonical Design Approval template. The dropdown is
// the source of truth for approve vs. reject — `document.completed`
// alone is ambiguous because customers sign whether they pick Approved
// OR Rejected from the dropdown.
export const DA_APPROVAL_DROPDOWN_FIELD_ID = "Design Approval Selection";
export const DA_REJECTION_REASON_FIELD_ID = "Rejection Reason";

function getApiKey(): string {
  const key = process.env.PANDADOC_API_KEY;
  if (!key) throw new Error("PANDADOC_API_KEY is not set");
  return key;
}

async function pandaFetch<T>(
  path: string,
  init?: RequestInit & { searchParams?: Record<string, string | number | undefined> },
): Promise<T> {
  const url = new URL(`${PANDADOC_BASE}${path}`);
  if (init?.searchParams) {
    for (const [k, v] of Object.entries(init.searchParams)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url.toString(), {
      ...init,
      headers: {
        Authorization: `API-Key ${getApiKey()}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (res.ok) return (await res.json()) as T;

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, Math.pow(2, attempt) * 1000 + Math.random() * 400);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`PandaDoc ${res.status} ${url.pathname}: ${text.slice(0, 300)}`);
  }
  throw new Error("PandaDoc retry exhausted");
}

/**
 * List documents from a single template, optionally filtered to those
 * modified after `modifiedFrom`. Auto-paginates.
 */
export async function listDocumentsByTemplate(opts: {
  templateId: string;
  modifiedFrom?: Date;
  pageSize?: number;
  maxPages?: number;
}): Promise<PandaDocListItem[]> {
  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 5;
  const out: PandaDocListItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await pandaFetch<{ results: PandaDocListItem[] }>("/documents", {
      searchParams: {
        template_id: opts.templateId,
        modified_from: opts.modifiedFrom?.toISOString(),
        count: pageSize,
        page,
        order_by: "-date_modified",
      },
    });
    if (!data.results || data.results.length === 0) break;
    out.push(...data.results);
    if (data.results.length < pageSize) break;
  }
  return out;
}

export async function getDocumentDetail(documentId: string): Promise<PandaDocDocumentDetail> {
  return pandaFetch<PandaDocDocumentDetail>(`/documents/${documentId}/details`);
}

/**
 * Find the most recent DA document linked to a HubSpot deal.
 * Uses PandaDoc metadata filter (set by the native HubSpot integration).
 */
export async function findDaForDeal(dealId: string): Promise<{
  id: string;
  name: string;
  status: string;
  url: string;
  dateSent: string | null;
  dateCompleted: string | null;
} | null> {
  const data = await pandaFetch<{ results: PandaDocListItem[] }>("/documents", {
    searchParams: {
      template_id: DA_TEMPLATE_ID,
      "metadata_hubspot.deal_id": dealId,
      count: 1,
      order_by: "-date_modified",
    },
  });
  const doc = data.results?.[0];
  if (!doc) return null;
  return {
    id: doc.id,
    name: doc.name,
    status: doc.status.replace("document.", ""),
    url: `https://app.pandadoc.com/a/#/documents/${doc.id}`,
    dateSent: doc.date_created,
    dateCompleted: doc.date_completed,
  };
}

/**
 * Pull the HubSpot deal id off a PandaDoc document. Tries `metadata.hubspot.deal_id`
 * first (set by the native HubSpot integration), then falls back to scanning
 * `linked_objects` for a deal entity.
 */
export function extractHubspotDealId(doc: PandaDocDocumentDetail): string | null {
  const metaId = doc.metadata?.["hubspot.deal_id"];
  if (typeof metaId === "string" && metaId) return metaId;
  if (typeof metaId === "number") return String(metaId);

  for (const link of doc.linked_objects ?? []) {
    if (link.provider === "hubspot" && link.entity_type === "deal" && link.entity_id) {
      return link.entity_id;
    }
  }
  return null;
}

/**
 * Read the customer's approval dropdown selection from the DA template.
 * Returns the dropdown's literal value (e.g. "Design Approved", "Design
 * Rejected") or null if the field is missing/unanswered.
 *
 * Why: customers SIGN the document whether they approve OR reject —
 * the dropdown is the actual decision. PandaDoc's `document.completed`
 * status alone cannot distinguish approve from reject.
 */
export function extractApprovalSelection(doc: PandaDocDocumentDetail): string | null {
  const f = doc.fields?.find((x) => x.field_id === DA_APPROVAL_DROPDOWN_FIELD_ID);
  if (!f) return null;
  if (typeof f.value === "string" && f.value.trim() !== "") return f.value.trim();
  return null;
}

/**
 * Resolve the expected HubSpot `layout_status` for a DA document.
 *
 * Logic:
 *  1. If the customer's approval dropdown is set, that's the source of truth.
 *  2. Otherwise, if PandaDoc reports `document.declined` (the customer
 *     formally declined without signing), map to "Design Rejected".
 *  3. Otherwise return null — we can't determine intent (e.g. the
 *     document was completed but the dropdown was left blank).
 *
 * Returning null causes the reconciler to skip the doc rather than
 * write a noisy false-positive drift row.
 */
export function expectedLayoutStatusForDoc(doc: PandaDocDocumentDetail): string | null {
  const dropdown = extractApprovalSelection(doc);
  if (dropdown === "Design Approved" || dropdown === "Design Rejected") return dropdown;
  if (doc.status === "document.declined") return "Design Rejected";
  return null;
}

/**
 * Cheap pre-filter: from a list response, decide whether the document is
 * worth fetching detail for. Detail fetches are 1 call each — list returns
 * documents with all sorts of statuses (`draft`, `viewed`, etc.) and we
 * don't want to fan out for those.
 */
export function isCandidateForReconcile(status: string): boolean {
  return status === "document.completed" || status === "document.declined";
}

/**
 * Group detailed docs by HubSpot deal id and keep only the latest per deal
 * (by `date_modified`). Returns the surviving docs plus the set of older
 * pandaDocIds that were dropped — used by callers to auto-resolve any
 * stale drift rows for the same deal.
 *
 * Why: a single deal can have multiple DA revisions in the same scan
 * window (original declined → revised approved). Only the latest doc's
 * dropdown reflects the customer's final decision, so it's the only one
 * worth comparing against `layout_status`. Older revisions create false
 * positives if compared in isolation.
 */
export function pickLatestDocPerDeal(
  docs: Array<{ detail: PandaDocDocumentDetail; dealId: string }>,
): {
  latest: Map<string, { detail: PandaDocDocumentDetail; dealId: string }>;
  supersededPandaDocIds: Set<string>;
} {
  const latest = new Map<string, { detail: PandaDocDocumentDetail; dealId: string }>();
  const supersededPandaDocIds = new Set<string>();
  for (const entry of docs) {
    const existing = latest.get(entry.dealId);
    if (!existing) {
      latest.set(entry.dealId, entry);
      continue;
    }
    // Compare by date_modified — newer wins; supersede the older.
    if (entry.detail.date_modified > existing.detail.date_modified) {
      supersededPandaDocIds.add(existing.detail.id);
      latest.set(entry.dealId, entry);
    } else {
      supersededPandaDocIds.add(entry.detail.id);
    }
  }
  return { latest, supersededPandaDocIds };
}

/**
 * Search PandaDoc for PE template IDs by name pattern.
 * Falls back to env vars if search returns ambiguous results.
 */
export async function discoverPeTemplateIds(): Promise<Record<PeTemplateKey, string | null>> {
  const result: Record<string, string | null> = {};

  const envOverrides: Record<PeTemplateKey, string | undefined> = {
    attestation: process.env.PANDADOC_PE_ATTESTATION_TEMPLATE_ID,
    acceptance: process.env.PANDADOC_PE_ACCEPTANCE_TEMPLATE_ID,
    progress_waiver: process.env.PANDADOC_PE_PROGRESS_WAIVER_TEMPLATE_ID,
    final_waiver: process.env.PANDADOC_PE_FINAL_WAIVER_TEMPLATE_ID,
  };

  for (const { key, pattern } of PE_TEMPLATE_PATTERNS) {
    if (envOverrides[key]) {
      result[key] = envOverrides[key]!;
      continue;
    }

    try {
      const data = await pandaFetch<{ results: Array<{ id: string; name: string }> }>("/templates", {
        searchParams: { q: pattern, count: 5 },
      });

      if (data.results?.length === 1) {
        result[key] = data.results[0].id;
      } else if (data.results?.length > 1) {
        // Ambiguous — prefer exact name match
        const exact = data.results.find((t) =>
          t.name.toLowerCase() === pattern.toLowerCase()
        );
        result[key] = exact?.id ?? null;
      } else {
        result[key] = null;
      }
    } catch {
      result[key] = null;
    }
  }

  return result as Record<PeTemplateKey, string | null>;
}

/**
 * Find the most recent PandaDoc document for each PE template, linked to a deal.
 */
export async function findPeDocsForDeal(
  dealId: string,
  templateIds: Record<PeTemplateKey, string | null>,
  /** Customer last name for fallback name-based search (e.g. "Brownell") */
  customerName?: string,
): Promise<PeTemplateStatus[]> {
  const results: PeTemplateStatus[] = [];

  for (const { key, pattern } of PE_TEMPLATE_PATTERNS) {
    const templateId = templateIds[key];
    if (!templateId) {
      results.push({ key, templateId: null, document: null });
      continue;
    }

    try {
      // Strategy 1: Search by template + HubSpot deal metadata
      const data = await pandaFetch<{ results: PandaDocListItem[] }>("/documents", {
        searchParams: {
          template_id: templateId,
          "metadata_hubspot.deal_id": dealId,
          count: 1,
          order_by: "-date_modified",
        },
      });

      let doc = data.results?.[0] ?? null;

      // Strategy 2: Fallback — search by document name containing the customer name.
      // Docs created via HubSpot's native PandaDoc CRM card don't always set
      // metadata_hubspot.deal_id, but they DO include the customer name in the
      // document title (e.g. "PE Installer Attestation - Brownell").
      if (!doc && customerName) {
        const nameQuery = `${pattern} - ${customerName}`;
        const fallback = await pandaFetch<{ results: PandaDocListItem[] }>("/documents", {
          searchParams: {
            template_id: templateId,
            q: nameQuery,
            count: 3,
            order_by: "-date_modified",
          },
        });
        doc = fallback.results?.[0] ?? null;
      }

      results.push({
        key,
        templateId,
        document: doc ? {
          id: doc.id,
          name: doc.name,
          status: doc.status.replace("document.", ""),
          dateCompleted: doc.date_completed,
        } : null,
      });
    } catch {
      results.push({ key, templateId, document: null });
    }
  }

  return results;
}

/**
 * Download a completed PandaDoc document as a PDF buffer.
 * Only works for documents with status "document.completed".
 */
export async function downloadPandaDocPdf(documentId: string): Promise<Buffer> {
  const url = `${PANDADOC_BASE}/documents/${documentId}/download`;

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `API-Key ${getApiKey()}` },
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, Math.pow(2, attempt) * 1000 + Math.random() * 400);
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    const text = await res.text().catch(() => "");
    throw new Error(`PandaDoc download ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error("PandaDoc download retry exhausted");
}
