// src/lib/shovels-permit-rollups.ts
//
// Single source of truth for the per-permit-type rollup fields written to the
// HubSpot Property object. Drives THREE consumers so they can never drift:
//   1. shovels-enrichment.ts   — live push on each enrichment
//   2. scripts/backfill-permit-rollups.ts — one-time backfill of enriched props
//   3. scripts/create-permit-rollup-properties.ts — creates the HubSpot fields
//
// For each tag we expose 5 filterable fields on the property record:
//   {tag}_permit_count, latest_{tag}_permit_date, latest_{tag}_permit_number,
//   latest_{tag}_permit_jurisdiction, latest_{tag}_permit_contractor
// plus a single total_permit_count.
//
// Design notes / learned landmines (see reference_shovels_hubspot_property_push):
//   - Only number/date/text field types — NO enumerations (property_type's enum
//     mismatch 400'd the whole batch).
//   - "latest" = most recent permit carrying the tag by coalesced issue/file date.

// The 24 Shovels permit tags present in our data (frequency-ordered).
export const PERMIT_TAGS = [
  "electrical", "roofing", "solar", "plumbing", "remodel", "new_construction",
  "hvac", "addition", "water_heater", "battery", "grading", "gas", "adu",
  "fire_sprinkler", "demolition", "bathroom", "window_door", "ev_charger",
  "pool_and_hot_tub", "kitchen", "electric_meter", "heat_pump", "generator",
  "telecom",
] as const;

export type PermitTag = (typeof PERMIT_TAGS)[number];

// Normalized permit shape both the Shovels API item and the DB record adapt to.
export interface RollupPermit {
  tags: string[];
  when: Date | null; // coalesced issue date (fallback file date)
  number: string | null;
  jurisdiction: string | null;
  contractorId: string | null;
}

// ── Adapters ────────────────────────────────────────────────────────────────

// From a Shovels API permit item (issue_date/file_date are YYYY-MM-DD strings).
export function fromApiPermit(p: {
  tags: string[] | null;
  issue_date: string | null;
  file_date: string | null;
  number: string | null;
  jurisdiction: string | null;
  contractor_id: string | null;
}): RollupPermit {
  const raw = p.issue_date ?? p.file_date;
  return {
    tags: p.tags ?? [],
    when: raw ? new Date(raw) : null,
    number: p.number,
    jurisdiction: p.jurisdiction,
    contractorId: p.contractor_id,
  };
}

// From a ShovelsPermitRecord DB row.
export function fromDbPermit(p: {
  tags: string[];
  issueDate: Date | null;
  fileDate: Date | null;
  permitNumber: string | null;
  jurisdiction: string | null;
  contractorId: string | null;
}): RollupPermit {
  return {
    tags: p.tags ?? [],
    when: p.issueDate ?? p.fileDate,
    number: p.permitNumber,
    jurisdiction: p.jurisdiction,
    contractorId: p.contractorId,
  };
}

// ── Core ────────────────────────────────────────────────────────────────────

// Latest permit per tag, by coalesced date (undated permits sort last).
function latestByTag(permits: RollupPermit[]): Map<string, RollupPermit> {
  const out = new Map<string, RollupPermit>();
  const best = new Map<string, number>(); // tag -> best epoch seen
  for (const p of permits) {
    const t = p.when ? p.when.getTime() : -Infinity;
    for (const tag of p.tags) {
      if (!out.has(tag) || t > (best.get(tag) ?? -Infinity)) {
        out.set(tag, p);
        best.set(tag, t);
      }
    }
  }
  return out;
}

// Contractor ids referenced by the latest-per-tag permits (the only ones whose
// names we need for the push — lets the caller fetch a minimal set).
export function contractorIdsForRollups(permits: RollupPermit[]): string[] {
  const ids = new Set<string>();
  for (const p of latestByTag(permits).values()) {
    if (p.contractorId) ids.add(p.contractorId);
  }
  return [...ids];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

// Build the HubSpot property map for all permit rollups.
// contractorLabel resolves a contractor id to a display string (or null).
export function computePermitRollups(
  permits: RollupPermit[],
  contractorLabel: (id: string) => string | null,
): Record<string, string | number | null> {
  const props: Record<string, string | number | null> = {};
  props.total_permit_count = permits.length;

  const counts = new Map<string, number>();
  for (const p of permits) for (const tag of p.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const latest = latestByTag(permits);

  for (const tag of PERMIT_TAGS) {
    props[`${tag}_permit_count`] = counts.get(tag) ?? 0;
    const l = latest.get(tag);
    if (!l) continue;
    const when = iso(l.when);
    if (when) props[`latest_${tag}_permit_date`] = when;
    if (l.number) props[`latest_${tag}_permit_number`] = l.number;
    if (l.jurisdiction) props[`latest_${tag}_permit_jurisdiction`] = l.jurisdiction;
    if (l.contractorId) {
      const label = contractorLabel(l.contractorId);
      if (label) props[`latest_${tag}_permit_contractor`] = label;
    }
  }
  return props;
}

// ── Field definitions (for the create-properties script) ─────────────────────

export interface RollupFieldDef {
  name: string;
  label: string;
  type: "number" | "date" | "string";
  fieldType: "number" | "date" | "text";
}

const titleCase = (tag: string) =>
  tag.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// All rollup field definitions (total + 5 per tag = 121).
export function permitRollupFieldDefs(): RollupFieldDef[] {
  const defs: RollupFieldDef[] = [
    { name: "total_permit_count", label: "Total Permit Count", type: "number", fieldType: "number" },
  ];
  for (const tag of PERMIT_TAGS) {
    const T = titleCase(tag);
    defs.push(
      { name: `${tag}_permit_count`, label: `${T} Permit Count`, type: "number", fieldType: "number" },
      { name: `latest_${tag}_permit_date`, label: `Latest ${T} Permit Date`, type: "date", fieldType: "date" },
      { name: `latest_${tag}_permit_number`, label: `Latest ${T} Permit #`, type: "string", fieldType: "text" },
      { name: `latest_${tag}_permit_jurisdiction`, label: `Latest ${T} Permit Jurisdiction`, type: "string", fieldType: "text" },
      { name: `latest_${tag}_permit_contractor`, label: `Latest ${T} Permit Contractor`, type: "string", fieldType: "text" },
    );
  }
  return defs;
}

// Shared contractor display formatter.
export function contractorLabelFrom(c: { name: string | null; license: string | null } | undefined | null): string | null {
  if (!c || !c.name) return null;
  return c.license ? `${c.name} (Lic ${c.license})` : c.name;
}
