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

export interface PeDocumentInfo {
  present: boolean;
  version: number;
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

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options);

    if (response.ok) return response;

    // Don't retry client errors (except 429)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return response;
    }

    // Retry on 429 or 5xx
    if (attempt < retries) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      // Check Retry-After header for 429
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : backoff;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  // If we exhausted retries, return the last response
  return fetch(url, options);
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * List all PE projects with cursor-based pagination.
 * Returns projects from the list endpoint (no actionItems).
 */
export async function listAllProjects(): Promise<PeProjectListItem[]> {
  const { apiKey, baseUrl } = getConfig();
  const projects: PeProjectListItem[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL("/v1/projects", baseUrl);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

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
 */
export async function getProjectDetails(
  internalIds: string[],
  concurrency = 5,
): Promise<Map<string, PeProjectDetail>> {
  const results = new Map<string, PeProjectDetail>();
  const errors: string[] = [];

  // Process in chunks of `concurrency`
  for (let i = 0; i < internalIds.length; i += concurrency) {
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

  return results;
}

// ---------------------------------------------------------------------------
// Document key → canonical name mapping
// ---------------------------------------------------------------------------

/**
 * Maps API document keys to the canonical names used in PeDocumentReview.
 * These must match the 15 document names in pe-scraper-sync.ts COMPACT_DOC_NAMES.
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
  permission_to_operate: "Permission to Operate (PTO)",
};
