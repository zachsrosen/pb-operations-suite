/**
 * scripts/apply-ahj-utility-approvals.ts
 *
 * Reads an xlsx of AHJ/Utility update recommendations (with a per-row `Decision`
 * column filled in by the team) and applies every `Approve` row to the
 * corresponding HubSpot custom-object record.
 *
 *   Default file: ~/Downloads/ahj-utility-update-recommendations.xlsx
 *   Sheet:        "AHJ & Utility Recommendations"
 *
 * Behavior:
 *   - Default mode is dry-run (prints PATCH bodies + summary, no writes).
 *   - Pass --commit to actually PATCH HubSpot.
 *   - Aborts up-front if any approved row references a `field` that isn't on
 *     the AHJ_PROPERTIES / UTILITY_PROPERTIES allowlist.
 *   - Groups multiple approved fields per record into a single PATCH.
 *   - Serial loop with withRetry() on 429s.
 *   - On --commit, writes tmp/ahj-utility-approvals-applied-<ISO>.json with
 *     per-record success/failure.
 *
 * Usage:
 *   npx tsx scripts/apply-ahj-utility-approvals.ts                 # dry-run
 *   npx tsx scripts/apply-ahj-utility-approvals.ts --commit        # write
 *   npx tsx scripts/apply-ahj-utility-approvals.ts --type utility  # filter
 *   npx tsx scripts/apply-ahj-utility-approvals.ts --file <path>
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { Client } from "@hubspot/api-client";
import {
  AHJ_OBJECT_TYPE,
  UTILITY_OBJECT_TYPE,
  AHJ_PROPERTIES,
  UTILITY_PROPERTIES,
  updateCustomObjectRecord,
  withRetry,
} from "../src/lib/hubspot-custom-objects";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  file: string;
  commit: boolean;
  typeFilter: "ahj" | "utility" | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    file: path.join(os.homedir(), "Downloads", "ahj-utility-update-recommendations.xlsx"),
    commit: false,
    typeFilter: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commit") out.commit = true;
    else if (a === "--file") out.file = argv[++i] ?? "";
    else if (a === "--type") {
      const v = (argv[++i] ?? "").toLowerCase();
      if (v !== "ahj" && v !== "utility") {
        console.error(`--type must be 'ahj' or 'utility', got: ${v}`);
        process.exit(1);
      }
      out.typeFilter = v;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npx tsx scripts/apply-ahj-utility-approvals.ts [--file <path>] [--type ahj|utility] [--commit]",
      );
      process.exit(0);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sheet row shape
// ---------------------------------------------------------------------------

interface RawRow {
  type?: string;
  id?: number | string;
  name?: string;
  deals?: number | string;
  field?: string;
  current_value?: string;
  suggested_value?: string;
  confidence?: string;
  reason?: string;
  Decision?: string;
}

interface ApprovedUpdate {
  type: "AHJ" | "Utility";
  id: string; // stringified int
  name: string;
  field: string;
  currentValue: string;
  suggestedValue: string;
  confidence: string;
}

interface RecordGroup {
  type: "AHJ" | "Utility";
  id: string;
  name: string;
  properties: Record<string, string>;
  fields: ApprovedUpdate[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normDecision(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function coerceId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  // HubSpot custom-object record IDs are positive integers; xlsx surfaces them as float64.
  return String(BigInt(Math.trunc(n)));
}

function classifyType(raw: unknown): "AHJ" | "Utility" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "ahj") return "AHJ";
  if (s === "utility") return "Utility";
  return null;
}

/**
 * The source generator left `id` blank on follow-on rows of multi-field records,
 * and left it blank entirely for a handful of records (Erie, Firestone, …).
 * We resolve missing ids in two passes:
 *   1. forward-fill within (type, name) groups in the sheet itself
 *   2. exact-name lookup against tmp/ahj-records.json + tmp/utility-records.json
 *      (the same JSON dumps the generator produced)
 * If both fail, abort with a clear list.
 */
/**
 * Walks up from CWD looking for tmp/<file>. The audit JSON dumps live in the
 * main repo root's tmp/, but this script may be invoked from a worktree whose
 * tmp/ doesn't exist. Returns first match or null.
 */
function findTmpFile(name: string): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "tmp", name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Also try the main PB-Operations-Suite repo root explicitly (worktrees → main checkout)
  const homeRepo = path.join(os.homedir(), "Downloads", "Dev Projects", "PB-Operations-Suite", "tmp", name);
  if (fs.existsSync(homeRepo)) return homeRepo;
  return null;
}

function buildNameLookup(): { ahj: Map<string, string[]>; utility: Map<string, string[]> } {
  const out = { ahj: new Map<string, string[]>(), utility: new Map<string, string[]>() };
  const ahjPath = findTmpFile("ahj-records.json");
  const utilPath = findTmpFile("utility-records.json");
  const sources: Array<{ path: string | null; bucket: Map<string, string[]> }> = [
    { path: ahjPath, bucket: out.ahj },
    { path: utilPath, bucket: out.utility },
  ];
  for (const { path: p, bucket } of sources) {
    if (!p || !fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Array<{
        id: string;
        properties: { record_name?: string | null };
      }>;
      for (const r of raw) {
        const name = (r.properties?.record_name ?? "").trim();
        if (!name || !r.id) continue;
        const arr = bucket.get(name) ?? [];
        if (!arr.includes(r.id)) arr.push(r.id);
        bucket.set(name, arr);
      }
    } catch (e) {
      console.warn(`Could not parse ${p}: ${(e as Error).message}`);
    }
  }
  return out;
}

function loadApprovedRows(
  file: string,
  typeFilter: Args["typeFilter"],
): {
  approved: ApprovedUpdate[];
  totals: { totalRows: number; approveRows: number; denyRows: number; needsReview: number; blank: number };
  resolutions: { forwardFilled: number; lookedUp: number };
} {
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase().includes("recommend")) ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[sheetName], { defval: null });

  const totals = { totalRows: rows.length, approveRows: 0, denyRows: 0, needsReview: 0, blank: 0 };
  const approved: ApprovedUpdate[] = [];

  // Pass A: forward-fill ids within (type, name) groups, scanning the whole sheet
  // (an approved row's id may live on a denied/blank row earlier in the same group).
  const filledIds = new Map<string, string>();
  for (const r of rows) {
    const t = classifyType(r.type);
    const id = coerceId(r.id);
    const name = String(r.name ?? "").trim();
    if (t && id && name) {
      filledIds.set(`${t}:${name}`, id);
    }
  }
  // Pass B: name lookup against the generator's JSON dumps for anything still missing
  const lookups = buildNameLookup();
  const resolutions = { forwardFilled: 0, lookedUp: 0 };
  const unresolved: Array<{ type: string; name: string; field: string }> = [];

  for (const r of rows) {
    const decision = normDecision(r.Decision);
    if (decision === "approve" || decision === "approved") totals.approveRows++;
    else if (decision === "deny" || decision === "denied") {
      totals.denyRows++;
      continue;
    } else if (decision.includes("needs review")) {
      totals.needsReview++;
      continue;
    } else if (decision === "" || decision === "null") {
      totals.blank++;
      continue;
    } else {
      // unknown decision token → treat as blank (not approved)
      totals.blank++;
      continue;
    }

    const type = classifyType(r.type);
    if (!type) {
      console.error(`Row with unrecognized type: ${JSON.stringify(r)}`);
      process.exit(1);
    }
    if (typeFilter && type.toLowerCase() !== typeFilter) continue;

    const name = String(r.name ?? "").trim();
    let id = coerceId(r.id);
    if (!id && name) {
      const filled = filledIds.get(`${type}:${name}`);
      if (filled) {
        id = filled;
        resolutions.forwardFilled++;
      } else {
        const bucket = type === "AHJ" ? lookups.ahj : lookups.utility;
        const candidates = bucket.get(name);
        if (candidates && candidates.length === 1) {
          id = candidates[0];
          resolutions.lookedUp++;
        } else if (candidates && candidates.length > 1) {
          console.error(
            `Ambiguous name lookup for ${type} '${name}' — ${candidates.length} HubSpot records share this name (ids: ${candidates.join(", ")}). Resolve in source sheet.`,
          );
          process.exit(1);
        }
      }
    }
    if (!id) {
      unresolved.push({ type, name, field: String(r.field ?? "") });
      continue;
    }
    const field = String(r.field ?? "").trim();
    if (!field) {
      console.error(`Approved row missing field: ${JSON.stringify(r)}`);
      process.exit(1);
    }
    const sv = r.suggested_value;
    if (sv === null || sv === undefined || String(sv).trim() === "") {
      console.error(`Approved row has empty suggested_value: ${JSON.stringify(r)}`);
      process.exit(1);
    }

    approved.push({
      type,
      id,
      name,
      field,
      currentValue: String(r.current_value ?? ""),
      suggestedValue: String(sv),
      confidence: String(r.confidence ?? ""),
    });
  }

  if (unresolved.length) {
    console.error("\nABORT: could not resolve HubSpot record id for these approved rows.");
    console.error("Forward-fill (in-sheet) and tmp/<type>-records.json lookup both failed.\n");
    for (const u of unresolved) {
      console.error(`  ${u.type}  '${u.name}'  field='${u.field}'`);
    }
    process.exit(1);
  }

  return { approved, totals, resolutions };
}

function validateFieldNames(rows: ApprovedUpdate[]): void {
  const ahjAllow = new Set<string>(AHJ_PROPERTIES);
  const utilAllow = new Set<string>(UTILITY_PROPERTIES);
  const offenders: { type: string; field: string; name: string; id: string }[] = [];
  for (const r of rows) {
    const allow = r.type === "AHJ" ? ahjAllow : utilAllow;
    if (!allow.has(r.field)) {
      offenders.push({ type: r.type, field: r.field, name: r.name, id: r.id });
    }
  }
  if (offenders.length) {
    console.error("\nABORT: approved rows reference fields not in the allowlist.\n");
    console.error("Add the field to AHJ_PROPERTIES / UTILITY_PROPERTIES in src/lib/hubspot-custom-objects.ts");
    console.error("if it is a real HubSpot property, or fix the typo in the source sheet.\n");
    for (const o of offenders) {
      console.error(`  ${o.type}  field='${o.field}'  record='${o.name}'  id=${o.id}`);
    }
    process.exit(1);
  }
}

/**
 * HubSpot schema constraints discovered at write time on 2026-04-28.
 * Some fields are enums or numbers, not free-text; the team's suggestions
 * include parentheticals, ranges, or descriptions that don't fit the schema.
 *
 * coerceForHubSpot() applies safe lossless-or-near-lossless mappings (strip
 * parentheticals, normalize Yes/No, prefix-match enums). When a value can't be
 * coerced, it's returned as { skip: true, reason } so the caller drops the
 * field write and surfaces it in the audit log.
 */
const HUBSPOT_ENUMS: Record<string, string[]> = {
  // AHJ
  ibc_code: ["2024IBC", "2021IBC", "2018IBC", "2015IBC", "2012IBC", "2022 County of Los Angeles Building Code"],
  ifc_code: ["2024IFC", "2021IFC", "2018IFC", "2015IFC", "2012IFC", "2009IFC", "2022 County of Los Angeles Fire Code"],
  irc_code: ["2024IRC", "2021IRC", "2018IRC", "2015IRC", "2012IRC", "2009IRC", "2006IRC", "2022 County of Los Angeles Residential Code"],
  submission_method: ["Portal", "Email", "Mail", "SolarApp+", "Symbium"],
  // Utility
  system_size_rule: ["120%", "200%", "N/A"],
  is_production_meter_required_: ["true", "false", "Yes if above 10 kW", "Yes if above 10 kWAC"],
};

const HUBSPOT_NUMBER_FIELDS = new Set<string>(["energy_rate"]);

interface CoerceResult {
  value: string | null;
  skip: boolean;
  reason?: string;
}

function coerceForHubSpot(field: string, raw: string): CoerceResult {
  const v = raw.trim();
  // Number fields — must parse as int per HubSpot's INVALID_INTEGER errors.
  if (HUBSPOT_NUMBER_FIELDS.has(field)) {
    // Reject ranges, currency symbols, units; don't pick a midpoint silently.
    if (/-/.test(v) || /[~$/a-zA-Z]/.test(v)) {
      return { value: null, skip: true, reason: `'${v}' isn't a clean integer for ${field} (HubSpot requires int)` };
    }
    const cleaned = v.replace(/[^0-9.-]/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
      return { value: null, skip: true, reason: `'${v}' couldn't be parsed as a number` };
    }
    return { value: cleaned, skip: false };
  }
  // Enum fields — try exact, then strip parenthetical, then prefix-match.
  const allowed = HUBSPOT_ENUMS[field];
  if (allowed) {
    if (allowed.includes(v)) return { value: v, skip: false };

    // Strip trailing parenthetical: "2018IFC (until July 2026)" → "2018IFC"
    const stripped = v.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (allowed.includes(stripped)) return { value: stripped, skip: false };

    // Yes/No normalization for booleanish enums (is_production_meter_required_)
    if (allowed.includes("true") && /^yes$/i.test(v)) return { value: "true", skip: false };
    if (allowed.includes("false") && /^no$/i.test(v)) return { value: "false", skip: false };

    // Prefix match: "120% of annual consumption" → "120%"
    for (const opt of allowed) {
      if (v.startsWith(opt) || stripped.startsWith(opt)) return { value: opt, skip: false };
    }
    return { value: null, skip: true, reason: `'${v}' is not in HubSpot enum for ${field}: [${allowed.join(", ")}]` };
  }
  // Free-text — pass through.
  return { value: v, skip: false };
}

/**
 * Manual resolutions for fields where the team approved two contradictory rows.
 * Each entry forces a single suggested_value to win and silences the conflict
 * check for that (type, name, field) tuple. Document the rationale.
 *
 * Decided 2026-04-28 with Zach (auto-mode "just figure it out"):
 *
 * - AHJ Teller County ifc_code → '2003IFC' (sheet row 128).
 *   Row 127 suggested 2021IFC but its reasoning cites a non-existent
 *   "Current 2003IFC" (the row's own current_value column says 2015IFC),
 *   so the recommendation was generated from stale/hallucinated state.
 *   Row 128 cites tellercounty.gov as the source of truth: county is on 2003IFC.
 *
 * - AHJ Windsor nec_code → '2023NEC' (clean, no parenthetical).
 *   Row 254's parenthetical "verify — state mandate is 2023..." pollutes a
 *   code field with prose. Row 252's clean '2023NEC' is the correct payload.
 */
const MANUAL_OVERRIDES: Record<string, string> = {
  "AHJ:Teller County:ifc_code": "2003IFC",
  "AHJ:Windsor:nec_code": "2023NEC",
};

interface SkippedField {
  type: string;
  id: string;
  name: string;
  field: string;
  rawValue: string;
  reason: string;
}

function groupByRecord(rows: ApprovedUpdate[]): {
  groups: RecordGroup[];
  appliedOverrides: string[];
  skipped: SkippedField[];
  coerced: Array<{ type: string; name: string; field: string; raw: string; coerced: string }>;
} {
  const groups = new Map<string, RecordGroup>();
  // Collect ALL conflicts before failing, so the user fixes them in one pass.
  const conflicts = new Map<string, ApprovedUpdate[]>();
  const overrideKeys = new Set<string>();
  const skipped: SkippedField[] = [];
  const coerced: Array<{ type: string; name: string; field: string; raw: string; coerced: string }> = [];
  for (const r of rows) {
    const key = `${r.type}:${r.id}`;
    let g = groups.get(key);
    if (!g) {
      g = { type: r.type, id: r.id, name: r.name, properties: {}, fields: [] };
      groups.set(key, g);
    }
    const overrideKey = `${r.type}:${r.name}:${r.field}`;
    const conflictKey = `${key}:${r.field}`;
    const overrideValue = MANUAL_OVERRIDES[overrideKey];
    const rawValue = overrideValue ?? r.suggestedValue;

    // Apply HubSpot schema coercion (enum prefix-match, strip parenthetical, etc.)
    const coerce = coerceForHubSpot(r.field, rawValue);
    if (coerce.skip) {
      skipped.push({
        type: r.type,
        id: r.id,
        name: r.name,
        field: r.field,
        rawValue,
        reason: coerce.reason ?? "could not coerce to HubSpot schema",
      });
      continue;
    }
    const writeValue = coerce.value ?? rawValue;
    if (writeValue !== rawValue) {
      coerced.push({ type: r.type, name: r.name, field: r.field, raw: rawValue, coerced: writeValue });
    }

    if (g.properties[r.field] !== undefined) {
      // If a manual override governs this field, silently keep the override value
      // and skip the conflict report for it.
      if (overrideValue !== undefined) {
        g.properties[r.field] = writeValue;
        overrideKeys.add(overrideKey);
        continue;
      }
      const arr = conflicts.get(conflictKey) ?? g.fields.filter((f) => f.field === r.field);
      arr.push(r);
      conflicts.set(conflictKey, arr);
      continue;
    }
    g.properties[r.field] = writeValue;
    if (overrideValue !== undefined) overrideKeys.add(overrideKey);
    g.fields.push({ ...r, suggestedValue: writeValue });
  }
  if (conflicts.size) {
    console.error("\nABORT: multiple Approve rows target the same field on the same record.");
    console.error("Pick one in the source sheet (Deny the others) and re-run.\n");
    for (const [, rows] of conflicts) {
      const head = rows[0];
      console.error(`  ${head.type}  ${head.name}  field='${head.field}'  (${rows.length} conflicting rows):`);
      for (const r of rows) {
        console.error(
          `    suggested='${r.suggestedValue}'   confidence=${r.confidence}`,
        );
      }
    }
    process.exit(1);
  }
  // Drop empty groups (every approved field for a record was skipped by coercion)
  const finalGroups = [...groups.values()].filter((g) => Object.keys(g.properties).length > 0);
  return { groups: finalGroups, appliedOverrides: [...overrideKeys], skipped, coerced };
}

function summarize(rows: ApprovedUpdate[]): void {
  const counts: Record<string, Record<string, number>> = { AHJ: {}, Utility: {} };
  for (const r of rows) {
    counts[r.type][r.field] = (counts[r.type][r.field] ?? 0) + 1;
  }
  for (const t of ["AHJ", "Utility"] as const) {
    const fields = Object.entries(counts[t]).sort((a, b) => b[1] - a[1]);
    if (!fields.length) continue;
    console.log(`\n  ${t}:`);
    for (const [f, c] of fields) console.log(`    ${f.padEnd(34)} ${c}`);
  }
}

function flagComplexValues(groups: RecordGroup[]): void {
  // Heuristic: free-text suggested values that contain ranges, conditionals,
  // or instructions to a human. Worth visual review even though they write fine.
  const flagged: { name: string; field: string; value: string }[] = [];
  for (const g of groups) {
    for (const f of g.fields) {
      const v = f.suggestedValue;
      if (
        /\bcheck\b/i.test(v) ||
        /varies/i.test(v) ||
        /\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?/.test(v) ||
        /;/.test(v) // multi-clause rules (utility system_size_rule etc.)
      ) {
        flagged.push({ name: g.name, field: f.field, value: v });
      }
    }
  }
  if (!flagged.length) return;
  console.log("\n  Free-text values worth eyeballing (write fine, but non-atomic):");
  for (const f of flagged.slice(0, 12)) {
    console.log(`    [${f.field}] ${f.name} → "${f.value}"`);
  }
  if (flagged.length > 12) console.log(`    ... +${flagged.length - 12} more`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.commit && !process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error("HUBSPOT_ACCESS_TOKEN is required for --commit");
    process.exit(1);
  }

  console.log(`Mode:    ${args.commit ? "COMMIT (writes to HubSpot)" : "DRY-RUN (no writes)"}`);
  console.log(`File:    ${args.file}`);
  if (args.typeFilter) console.log(`Filter:  type=${args.typeFilter}`);
  console.log("");

  const { approved, totals, resolutions } = loadApprovedRows(args.file, args.typeFilter);
  console.log(
    `Sheet decisions — total=${totals.totalRows}  approve=${totals.approveRows}  ` +
      `deny=${totals.denyRows}  needs-review=${totals.needsReview}  blank=${totals.blank}`,
  );
  console.log(
    `ID resolution — forward-filled=${resolutions.forwardFilled}  ` +
      `looked-up-by-name=${resolutions.lookedUp}`,
  );
  if (args.typeFilter) console.log(`After --type filter: ${approved.length} approved rows`);

  if (!approved.length) {
    console.log("No approved rows after filtering. Nothing to do.");
    return;
  }

  validateFieldNames(approved);

  const { groups, appliedOverrides, skipped, coerced } = groupByRecord(approved);
  console.log(
    `Grouped: ${groups.length} record(s) — AHJ=${groups.filter((g) => g.type === "AHJ").length}  ` +
      `Utility=${groups.filter((g) => g.type === "Utility").length}`,
  );
  if (appliedOverrides.length) {
    console.log(`\nManual overrides applied (${appliedOverrides.length}):`);
    for (const k of appliedOverrides) {
      console.log(`  ${k}  →  '${MANUAL_OVERRIDES[k]}'`);
    }
  }
  if (coerced.length) {
    console.log(`\nValues coerced to HubSpot schema (${coerced.length}):`);
    for (const c of coerced) {
      console.log(`  ${c.type} ${c.name} • ${c.field}: '${c.raw}' → '${c.coerced}'`);
    }
  }
  if (skipped.length) {
    console.log(`\nSkipped — value couldn't be coerced to HubSpot schema (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  ${s.type} ${s.name} • ${s.field}: '${s.rawValue}'`);
      console.log(`    reason: ${s.reason}`);
    }
  }

  console.log("\nApproved-field counts by type:");
  summarize(approved);
  flagComplexValues(groups);

  // Dry-run: print every PATCH body, then exit.
  if (!args.commit) {
    console.log("\n--- DRY-RUN: planned PATCH calls ---");
    for (const g of groups) {
      const objectTypeId = g.type === "AHJ" ? AHJ_OBJECT_TYPE : UTILITY_OBJECT_TYPE;
      console.log(
        `\nPATCH /crm/v3/objects/${objectTypeId}/${g.id}   # ${g.type} • ${g.name} • ${g.fields.length} field(s)`,
      );
      console.log(JSON.stringify({ properties: g.properties }, null, 2));
    }
    console.log("\nDry-run complete. Re-run with --commit to apply.");
    return;
  }

  // Commit path
  console.log("\n--- COMMIT: applying updates ---");
  const results: Array<{
    type: string;
    id: string;
    name: string;
    fieldCount: number;
    fields: string[];
    status: "ok" | "error";
    updatedAt?: string;
    error?: string;
  }> = [];

  for (const g of groups) {
    const objectTypeId = g.type === "AHJ" ? AHJ_OBJECT_TYPE : UTILITY_OBJECT_TYPE;
    const fieldList = Object.keys(g.properties);
    process.stdout.write(
      `  ${g.type.padEnd(7)} ${g.id.padEnd(11)} ${g.name.padEnd(34)} ${fieldList.length} field(s) ... `,
    );
    try {
      const res = await updateCustomObjectRecord(objectTypeId, g.id, g.properties);
      results.push({
        type: g.type,
        id: g.id,
        name: g.name,
        fieldCount: fieldList.length,
        fields: fieldList,
        status: "ok",
        updatedAt: res.updatedAt,
      });
      console.log("ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        type: g.type,
        id: g.id,
        name: g.name,
        fieldCount: fieldList.length,
        fields: fieldList,
        status: "error",
        error: msg,
      });
      console.log(`ERROR  ${msg}`);
    }
    // Tiny spacer to stay well under HubSpot's 100 req / 10s limit.
    await new Promise((r) => setTimeout(r, 120));
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  console.log(`\nWrites done. ok=${ok}  failed=${failed}  total=${results.length}`);

  // ---------------------------------------------------------------------
  // Verification — re-fetch every updated record and confirm each property
  // we wrote actually persisted with the value we sent.
  // ---------------------------------------------------------------------
  console.log("\n--- VERIFY: re-fetching records and asserting persisted values ---");
  const client = new Client({
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    numberOfApiCallRetries: 2,
  });

  const verification: Array<{
    type: string;
    id: string;
    name: string;
    field: string;
    expected: string;
    actual: string | null;
    match: boolean;
  }> = [];

  for (const g of groups) {
    // Skip records that errored on write — no point verifying.
    const writeResult = results.find((r) => r.type === g.type && r.id === g.id);
    if (writeResult?.status !== "ok") continue;

    const objectTypeId = g.type === "AHJ" ? AHJ_OBJECT_TYPE : UTILITY_OBJECT_TYPE;
    const propsToFetch = Object.keys(g.properties);
    try {
      const fresh = await withRetry(() =>
        client.crm.objects.basicApi.getById(objectTypeId, g.id, propsToFetch),
      );
      const actualProps = (fresh.properties ?? {}) as Record<string, string | null>;
      for (const [field, expected] of Object.entries(g.properties)) {
        const actual = actualProps[field] ?? null;
        const match = String(actual ?? "") === String(expected);
        verification.push({ type: g.type, id: g.id, name: g.name, field, expected, actual, match });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const [field, expected] of Object.entries(g.properties)) {
        verification.push({
          type: g.type,
          id: g.id,
          name: g.name,
          field,
          expected,
          actual: null,
          match: false,
        });
      }
      console.log(`  ${g.type} ${g.name} (${g.id}): VERIFY FAILED  ${msg}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const verifyOk = verification.filter((v) => v.match).length;
  const verifyMismatch = verification.filter((v) => !v.match);
  console.log(`Verify: matched=${verifyOk}  mismatched=${verifyMismatch.length}  total=${verification.length}`);
  if (verifyMismatch.length) {
    console.log("\nMISMATCHES:");
    for (const m of verifyMismatch.slice(0, 25)) {
      console.log(
        `  ${m.type} ${m.name} (${m.id})  field='${m.field}'\n    expected: ${JSON.stringify(m.expected)}\n    actual:   ${JSON.stringify(m.actual)}`,
      );
    }
    if (verifyMismatch.length > 25) console.log(`  ... +${verifyMismatch.length - 25} more`);
  }

  // Audit log
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `ahj-utility-approvals-applied-${ts}.json`);
  const audit = {
    runId: ts,
    mode: "commit",
    file: args.file,
    typeFilter: args.typeFilter,
    totalApprovedRows: approved.length,
    recordCount: groups.length,
    okCount: ok,
    failedCount: failed,
    results,
    verification: {
      total: verification.length,
      matched: verifyOk,
      mismatched: verifyMismatch.length,
      mismatches: verifyMismatch,
    },
    coerced,
    skipped,
  };
  fs.writeFileSync(outFile, JSON.stringify(audit, null, 2));
  console.log(`\nAudit log: ${outFile}`);

  if (failed > 0 || verifyMismatch.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
