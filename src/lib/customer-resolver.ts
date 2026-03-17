/**
 * Customer Resolver Module
 *
 * Searches HubSpot contacts + companies, groups by canonical identity
 * (Company ID + normalized address), expands via company associations,
 * and resolves deal/ticket/Zuper job associations for detail view.
 *
 * Spec: docs/superpowers/specs/2026-03-17-customer-history-design.md
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _BATCH_SIZE = 100;
const _MAX_SEARCH_RESULTS = 25;

/** Company names to treat as empty/generic */
const GENERIC_COMPANY_NAMES = new Set([
  "unknown company",
  "unknown",
  "n/a",
  "na",
  "none",
  "test",
  "test company",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerSummary {
  groupKey: string;
  displayName: string;
  address: string;
  contactIds: string[];
  companyId: string | null;
  dealCount: number;
  ticketCount: number;
  jobCount: number;
}

export interface CustomerDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: string | null;
  location: string | null;
  closeDate: string | null;
  lastModified: string;
}

export interface CustomerTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string;
  lastModified: string;
}

export interface CustomerJob {
  uid: string;
  title: string;
  category: string | null;
  status: string | null;
  scheduledDate: string | null;
  createdAt: string | null;
}

export interface CustomerDetail extends CustomerSummary {
  contacts: CustomerContact[];
  deals: CustomerDeal[];
  tickets: CustomerTicket[];
  jobs: CustomerJob[];
}

export interface SearchResult {
  results: CustomerSummary[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Address Normalization
// ---------------------------------------------------------------------------

/** Street suffix abbreviation → full form */
const SUFFIX_MAP: Record<string, string> = {
  st: "street",
  ave: "avenue",
  dr: "drive",
  blvd: "boulevard",
  ln: "lane",
  ct: "court",
  rd: "road",
  pl: "place",
  cir: "circle",
  way: "way",
  pkwy: "parkway",
  trl: "trail",
};

/** Directional abbreviation → full form */
const DIRECTIONAL_MAP: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/**
 * Normalize a street address + zip into a canonical grouping key.
 * Returns `"{normalized_street}|{zip5}"` or null if inputs are missing.
 */
export function normalizeAddress(street: string | null | undefined, zip: string | null | undefined): string | null {
  if (!street || !zip) return null;

  const trimmedStreet = street.trim();
  const trimmedZip = zip.trim();
  if (!trimmedStreet || !trimmedZip) return null;

  // Take first 5 digits of zip
  const zip5 = trimmedZip.replace(/[^0-9]/g, "").slice(0, 5);
  if (zip5.length < 5) return null;

  // Lowercase, strip periods, collapse whitespace
  let normalized = trimmedStreet
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Expand directionals and suffixes — only standalone tokens
  normalized = normalized
    .split(" ")
    .map((token) => {
      if (DIRECTIONAL_MAP[token]) return DIRECTIONAL_MAP[token];
      if (SUFFIX_MAP[token]) return SUFFIX_MAP[token];
      return token;
    })
    .join(" ");

  return `${normalized}|${zip5}`;
}

// ---------------------------------------------------------------------------
// Display Name
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable display name for a customer group.
 * 1. Company name (if present and not generic)
 * 2. "{LastName} Residence" from first contact with a last name
 * 3. Formatted address as fallback
 */
export function deriveDisplayName(
  companyName: string | null | undefined,
  contacts: Array<{ lastName: string | null | undefined }>,
  address: string
): string {
  if (companyName && !GENERIC_COMPANY_NAMES.has(companyName.toLowerCase().trim())) {
    return companyName.trim();
  }

  for (const c of contacts) {
    if (c.lastName && c.lastName.trim()) {
      return `${c.lastName.trim()} Residence`;
    }
  }

  return address;
}

// ---------------------------------------------------------------------------
// Phase 1: Multi-Entity Search
// ---------------------------------------------------------------------------
// (Implemented in Task 4)

// ---------------------------------------------------------------------------
// Phase 2: Identity Grouping + Expansion
// ---------------------------------------------------------------------------
// (Implemented in Task 5)

// ---------------------------------------------------------------------------
// Phase 3: Association Resolution (Detail only)
// ---------------------------------------------------------------------------
// (Implemented in Task 6)
