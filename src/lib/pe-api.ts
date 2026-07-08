/**
 * PE Raceway API Client
 *
 * Typed client for the Participate Energy Raceway API.
 * Handles authentication, cursor-based pagination, and retry with backoff.
 *
 * Endpoints used:
 *   GET /v1/projects         — list projects (cursor pagination, 25/page)
 *   GET /v1/projects/{id}    — single project detail (includes actionItems[])
 *   GET /v1/avl              — approved vendor list
 *
 * Auth: Bearer token in Authorization header.
 * Env: PE_API_KEY, PE_API_BASE_URL (defaults to test endpoint)
 */

// ---------------------------------------------------------------------------
// Types — mirror the Raceway API response shapes
// ---------------------------------------------------------------------------

export interface PeCustomer {
  firstName: string;
  lastName: string;
  email: string;
}

export interface PeLatLong {
  lat: number;
  lng: number;
}

export interface PeProjectInfo {
  street: string;
  city: string;
  zipCode: number;
  county: string;
  state: string;
  latLong: PeLatLong;
  solarYield: number;
  utility: string;
  meterId: number | null;
  nameOnUtilityBill: string;
  installPartner: string;
  productType: string;
  currentMilestone: string;
  status: string;
  salesRepEmail: string;
}

export interface PeEquipment {
  moduleSku: string;
  moduleQuantity: number;
  inverterSku: string;
  rackingPartNumber: string;
  storageQuantity: number;
}

export interface PeAssets {
  systemSizeKw: number;
  systemType: string;
  firstYearSolarProductionKwh: number;
  equipment: PeEquipment;
}

export interface PeFinancials {
  epcAmount: number;
  lender: string;
  netAmountDue: number;
  replacementCostOfSystem: number;
  leaseAmount: number;
  recipientOfDcBonus: string;
  includedIncentive1Name: string;
  includedIncentive1Amount: number;
  includedIncentive2Name: string;
  includedIncentive2Amount: number;
  paymentAtIC: number;
  paymentAtPC: number;
}

export interface PeTaxCredit {
  energyCommunityEligible: boolean;
  pvDcEligible: boolean;
  bessDcEligible: boolean | null;
}

/**
 * One entry of a document's upload history. Added by Raceway 2026-06-12.
 * uploadedBy is null on versions uploaded before PE tracked attribution.
 */
export interface PeDocVersionEntry {
  version: number;
  uploadedAt: string; // ISO timestamp
  uploadedBy: string | null;
  fileName?: string;
  source?: string; // portal_upload | contract_upload
}

export interface PeDocumentInfo {
  present: boolean;
  version: number;
  /**
   * Review status, added by Raceway 2026-06-12.
   * Observed values: APPROVED | PENDING_REVIEW | PENDING_APPROVAL |
   * RESPONSE_NEEDED | null (not uploaded / not yet reviewed).
   */
  status?: string | null;
  /** Full upload history (also added 2026-06-12). */
  versions?: PeDocVersionEntry[];
}

export interface PeDocuments {
  installationOrder: PeDocumentInfo;
  signedProposal: PeDocumentInfo;
  utilityBill: PeDocumentInfo;
  stateDisclosures: PeDocumentInfo;
  designPlan: PeDocumentInfo;
  photos: PeDocumentInfo;
  certificateOfAcceptance: PeDocumentInfo;
  attestationOfCustomerPayment: PeDocumentInfo;
  signedInterconnectionAgreement: PeDocumentInfo;
  permissionToOperate: PeDocumentInfo;
  signedFinalPermit: PeDocumentInfo;
  conditionalProgressLienWaiver: PeDocumentInfo;
  conditionalWaiverReleaseFinalPayment: PeDocumentInfo;
  accessToMonitoring: PeDocumentInfo;
  customerAgreement: PeDocumentInfo;
  billOfMaterials: PeDocumentInfo; // split into its own upload by PE 2026-06 (was bundled in Photos)
  // Other keys PE added in the same restructure (signedContract, changeOrders,
  // issuedPermit) are reachable via the index signature but intentionally not
  // tracked/required yet.
  [key: string]: PeDocumentInfo; // allow dynamic access
}

export interface PeTimestamps {
  actuals: {
    contractSignedDate?: string;
    [key: string]: string | undefined;
  };
  projections: {
    forecastedInstallationDate?: string;
    forecastedInterconnectionDate?: string;
    forecastedFinalInspectionDate?: string;
    [key: string]: string | undefined;
  };
}

export interface PeActionItemDocument {
  type: string;
  id: string;   // e.g. "design_plan", "countersigned_ppa_esa"
  label: string; // e.g. "Design Plan", "Customer Agreement (PPA/ESA)"
}

export interface PeActionItem {
  id: string;
  date: string;
  activityBy: string;
  notes: string;
  document: PeActionItemDocument;
}

export interface PeSync {
  syncedAt: string;
  source: string;
}

export interface PeHubSpot {
  recordId: number;
}

/** Project shape returned by the LIST endpoint (no actionItems). */
export interface PeProjectListItem {
  id: string;           // internal Raceway UUID
  projectId: string;    // e.g. "CO2602-KRAF2"
  orgId: string;
  customer: PeCustomer;
  project: PeProjectInfo;
  assets: PeAssets;
  financials: PeFinancials;
  taxCredit: PeTaxCredit;
  timestamps: PeTimestamps;
  stateCode: string;
  documents: PeDocuments;
  contractType: string;
  _sync: PeSync;
  _hubspot: PeHubSpot;
  createdAt: string;
  updatedAt: string;
}

/** Project shape returned by the DETAIL endpoint (includes actionItems). */
export interface PeProjectDetail extends PeProjectListItem {
  actionItems: PeActionItem[];
}

export interface PePagination {
  pageSize: number;
  hasMore: boolean;
  nextCursor?: string;
  resultCount: number;
}

export interface PeProjectListResponse {
  success: boolean;
  data: {
    projects: PeProjectListItem[];
    pagination: PePagination;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export interface PeProjectDetailResponse {
  success: boolean;
  data: PeProjectDetail;
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export interface PeApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    documentationUrl?: string;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://pe-paddock-api.raceway.ai";

function getConfig() {
  const apiKey = process.env.PE_API_KEY;
  if (!apiKey) {
    throw new Error("PE_API_KEY environment variable is not set");
  }
  const baseUrl = process.env.PE_API_BASE_URL || DEFAULT_BASE_URL;
  return { apiKey, baseUrl };
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * True if a PE error body is the DAILY quota cap (`QUOTA_EXCEEDED` /
 * `dailyApiCalls`). Retrying these is pointless — they don't recover until the
 * daily reset — and each retry burns another call against the same quota.
 */
export function isDailyQuotaError(body: string): boolean {
  return /QUOTA_EXCEEDED|dailyApiCalls/i.test(body);
}

/** Pull the `resetsAt` ISO timestamp out of a PE quota error body, or null. */
export function parseQuotaResetAt(body: string): string | null {
  const m = body.match(/"resetsAt"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options);
    last = response;

    if (response.ok) return response;

    if (response.status === 429) {
      // A daily-quota 429 won't recover until reset — return immediately rather
      // than retrying (which only burns more of the exhausted quota).
      const body = await response.clone().text().catch(() => "");
      if (isDailyQuotaError(body)) return response;
      // otherwise fall through: transient rate limit, retry with backoff
    } else if (response.status >= 400 && response.status < 500) {
      // Other client errors aren't retryable.
      return response;
    }

    // Retry on transient 429 or 5xx, unless this was the last attempt.
    if (attempt < retries) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  // Retries exhausted — return the last response (no extra fetch).
  return last!;
}

/** Exported for unit testing the retry/quota behavior. */
export { fetchWithRetry };

/**
 * True if a project has at least one document in `RESPONSE_NEEDED` — the only
 * projects whose DETAIL (action items / reviewer notes) we need to fetch. Doc
 * `status` + `versions[]` come from the cheap LIST response for every project,
 * so projects with nothing in `RESPONSE_NEEDED` don't need a per-project call.
 */
export function projectNeedsActionItemDetail(p: {
  documents: Record<string, { status?: string | null } | undefined>;
}): boolean {
  return Object.values(p.documents || {}).some((d) => d?.status === "RESPONSE_NEEDED");
}

/**
 * Choose which RESPONSE_NEEDED projects actually need a (quota-costly) DETAIL
 * fetch this run. The DETAIL endpoint's only addition over the cheap LIST is
 * `actionItems` (reviewer notes), so we spend a call only when there's a note we
 * haven't captured yet:
 *   - no open captured action item for the project  → a fresh rejection, pull it;
 *   - PE touched the project (`updatedAt`) after our latest captured note → refresh.
 * Already-captured, unchanged rejections are skipped. Re-pulling all ~70 standing
 * rejections every run is what drained the PE daily quota and starved the detail
 * phase to zero — dropping notes on brand-new rejections (so their "Rejected"
 * email fired blank). Narrowing to new/changed keeps quota healthy so every fresh
 * rejection's note lands with its status, no holding required.
 *
 * @param responseNeeded  list projects with at least one RESPONSE_NEEDED doc
 * @param capturedAtByProject  peProjectId → latest captured (open) action-item time (ms)
 * @returns internal ids to DETAIL-fetch
 */
export function selectDetailFetchIds(
  responseNeeded: { id: string; projectId: string; updatedAt?: string | null }[],
  capturedAtByProject: Map<string, number>,
): string[] {
  const ids: string[] = [];
  for (const p of responseNeeded) {
    const capturedAt = capturedAtByProject.get(p.projectId);
    if (capturedAt == null) {
      ids.push(p.id); // never captured a note for this open rejection → must pull
      continue;
    }
    const updated = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
    if (!Number.isNaN(updated) && updated > capturedAt) {
      ids.push(p.id); // PE changed the project since we captured → refresh notes
    }
  }
  return ids;
}

/** True if a stored quota-block timestamp is still in the future (sync should skip). */
export function quotaBlockActive(
  blockedUntilIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (!blockedUntilIso) return false;
  const t = Date.parse(blockedUntilIso);
  return !Number.isNaN(t) && t > nowMs;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * List all PE projects with cursor-based pagination.
 * Returns projects from the list endpoint (no actionItems).
 *
 * @param options.since - Only return projects updated after this ISO date string.
 *                        Used for incremental sync — omit for full initial sync.
 */
export async function listAllProjects(options?: {
  since?: string;
}): Promise<PeProjectListItem[]> {
  const { apiKey, baseUrl } = getConfig();
  const projects: PeProjectListItem[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL("/v1/projects", baseUrl);
    url.searchParams.set("pageSize", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    if (options?.since) url.searchParams.set("since", options.since);

    const response = await fetchWithRetry(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `PE API list projects failed: ${response.status} ${response.statusText} — ${body.substring(0, 500)}`,
      );
    }

    const data: PeProjectListResponse = await response.json();
    if (!data.success) {
      throw new Error(
        `PE API list projects returned success=false: ${JSON.stringify((data as unknown as PeApiError).error)}`,
      );
    }

    projects.push(...data.data.projects);
    cursor = data.data.pagination.hasMore
      ? data.data.pagination.nextCursor
      : undefined;
  } while (cursor);

  return projects;
}

/**
 * Get a single project's detail (includes actionItems).
 * This is the only way to get action items — they aren't on the list endpoint.
 */
export async function getProjectDetail(
  internalId: string,
): Promise<PeProjectDetail> {
  const { apiKey, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/projects/${internalId}`;

  const response = await fetchWithRetry(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `PE API get project ${internalId} failed: ${response.status} — ${body.substring(0, 500)}`,
    );
  }

  const data: PeProjectDetailResponse = await response.json();
  if (!data.success) {
    throw new Error(
      `PE API get project ${internalId} returned success=false: ${JSON.stringify((data as unknown as PeApiError).error)}`,
    );
  }

  return data.data;
}

/**
 * Batch-fetch project details for action items.
 * Fetches in parallel with concurrency limit to avoid overwhelming the API.
 *
 * @param internalIds - Firestore doc IDs to fetch
 * @param concurrency - Max parallel fetches (default 10)
 * @param deadlineMs - Epoch timestamp deadline. If set, stops fetching new
 *                     batches when within 30s of the deadline to leave time
 *                     for DB upserts. Already-inflight requests are awaited.
 */
export async function getProjectDetails(
  internalIds: string[],
  concurrency = 10,
  deadlineMs?: number,
): Promise<Map<string, PeProjectDetail>> {
  const results = new Map<string, PeProjectDetail>();
  const errors: string[] = [];
  let skippedDueToDeadline = 0;

  // Process in chunks of `concurrency`
  for (let i = 0; i < internalIds.length; i += concurrency) {
    // Check deadline before starting a new batch — leave 30s for DB work
    if (deadlineMs && Date.now() > deadlineMs - 30_000) {
      skippedDueToDeadline = internalIds.length - i;
      console.warn(
        `[pe-api] Deadline approaching, skipping ${skippedDueToDeadline} remaining detail fetches`,
      );
      break;
    }

    const batch = internalIds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((id) => getProjectDetail(id)),
    );

    for (let j = 0; j < settled.length; j++) {
      const result = settled[j];
      if (result.status === "fulfilled") {
        results.set(result.value.id, result.value);
      } else {
        errors.push(
          `Failed to fetch ${batch[j]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.warn(`[pe-api] ${errors.length} project detail fetch errors:`, errors.slice(0, 5));
  }
  if (skippedDueToDeadline > 0) {
    console.warn(`[pe-api] ${skippedDueToDeadline} projects skipped due to time budget`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Document key → canonical name mapping
// ---------------------------------------------------------------------------

/**
 * Maps API document keys to the canonical names used in PeDocumentReview.
 *
 * Adding a key here makes the sync write a PeDocumentReview row for it. Docs PE
 * only creates a slot for on *some* projects must also be listed in
 * `PE_CONDITIONAL_DOC_NAMES` (pe-analytics.ts), otherwise an absent slot is
 * recorded as NOT_UPLOADED and reads as missing on every project. Pushing a doc's
 * status/notes to HubSpot is opt-in via `PE_DOC_PROPERTIES` (pe-hubspot-sync.ts).
 */
export const PE_API_DOC_MAP: Record<string, string> = {
  customerAgreement: "Customer Agreement (PPA/ESA)",
  installationOrder: "Installation Order",
  stateDisclosures: "State Disclosures",
  utilityBill: "Utility Bill",
  signedProposal: "Signed Proposal",
  designPlan: "Design Plan",
  photos: "Photos per Policy",
  signedFinalPermit: "Signed Final Permit",
  accessToMonitoring: "Access to Monitoring",
  certificateOfAcceptance: "Certificate of Acceptance",
  attestationOfCustomerPayment: "Attestation of Customer Payment",
  conditionalProgressLienWaiver: "Conditional Progress Lien Waiver",
  signedInterconnectionAgreement: "Signed Interconnection Agreement",
  conditionalWaiverReleaseFinalPayment: "Conditional Waiver — Final Payment",
  permissionToOperate: "Permission to Operate (PTO)",
  billOfMaterials: "Bill of Materials",
  // PE's remediation instrument, not a milestone requirement. PE creates the slot
  // only on projects that have one, so it is CONDITIONAL (see
  // PE_CONDITIONAL_DOC_NAMES) and never reads as missing. Tracking it lets us tell
  // "blocked, needs a Change Order" apart from "Change Order submitted, awaiting PE".
  changeOrders: "Change Order",
};

/**
 * Maps action item document IDs (from actionItems[].document.id) to
 * canonical document names.
 */
export const PE_ACTION_DOC_MAP: Record<string, string> = {
  countersigned_ppa_esa: "Customer Agreement (PPA/ESA)",
  customer_agreement: "Customer Agreement (PPA/ESA)",
  installation_order: "Installation Order",
  state_disclosures: "State Disclosures",
  utility_bill: "Utility Bill",
  signed_proposal: "Signed Proposal",
  design_plan: "Design Plan",
  photos_per_policy: "Photos per Policy",
  signed_final_permit: "Signed Final Permit",
  access_to_monitoring: "Access to Monitoring",
  certificate_of_acceptance: "Certificate of Acceptance",
  attestation_of_customer_payment: "Attestation of Customer Payment",
  conditional_progress_lien_waiver: "Conditional Progress Lien Waiver",
  signed_interconnection_agreement: "Signed Interconnection Agreement",
  conditional_waiver_final_payment: "Conditional Waiver — Final Payment",
  conditional_waiver_final: "Conditional Waiver — Final Payment", // PE API's current id for this doc
  permission_to_operate: "Permission to Operate (PTO)",
  bill_of_materials: "Bill of Materials",
};
