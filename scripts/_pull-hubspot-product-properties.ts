/**
 * Pull all HubSpot Products object properties to find candidates for
 * spec-field → HubSpot property mappings.
 *
 * Read-only. Output: scripts/hubspot-product-properties.json
 *
 * Run: node --env-file=.env.local --import tsx scripts/_pull-hubspot-product-properties.ts
 */
const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("HUBSPOT_ACCESS_TOKEN missing");
  process.exit(1);
}

interface HsProperty {
  name?: string;
  label?: string;
  type?: string;
  fieldType?: string;
  groupName?: string;
  description?: string;
  options?: Array<{ label?: string; value?: string }>;
}

async function listProperties(): Promise<HsProperty[]> {
  const res = await fetch(`https://api.hubapi.com/crm/v3/properties/products`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`Property list failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.results || [];
}

function looksLikeSpecCandidate(name: string, label: string): boolean {
  const combined = `${name} ${label}`.toLowerCase();
  // Heuristic: matches concepts likely to be solar spec data
  return /\b(efficiency|wattage|cell|voc|isc|vmp|imp|temp|coefficient|phase|mppt|voltage|chemistry|capacity|kwh|kw|amperage|connector|level|mount|tilt|wind|snow|gauge|conduit|monitor|connectivity|inverter|battery|module|panel|micro|optimizer)\b/.test(combined);
}

async function main() {
  console.log("Fetching HubSpot Products properties...\n");
  const props = await listProperties();
  console.log(`Total properties: ${props.length}\n`);

  // Group by groupName for browsing
  const byGroup = new Map<string, HsProperty[]>();
  for (const p of props) {
    const g = p.groupName || "(no group)";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(p);
  }

  // Heuristic candidates first
  const candidates = props.filter((p) => looksLikeSpecCandidate(p.name || "", p.label || ""));
  console.log("─".repeat(80));
  console.log(`SPEC-RELATED PROPERTY CANDIDATES (${candidates.length})`);
  console.log("─".repeat(80));
  candidates.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  for (const p of candidates) {
    const opts = p.options?.length ? ` [${p.options.length} options]` : "";
    console.log(`  ${(p.name || "").padEnd(40)} ${(p.label || "").padEnd(38)} ${p.type}/${p.fieldType}${opts}`);
  }

  // Show internal_*, zoho_*, zuper_*, qbo_* (cross-link & sync infra)
  const sync = props.filter((p) => /^(internal|zoho|zuper|qbo|hs_)_/.test(p.name || "") || /(_id|_sku)$/.test(p.name || ""));
  console.log("\n" + "─".repeat(80));
  console.log(`SYNC/ID PROPERTIES (${sync.length})`);
  console.log("─".repeat(80));
  for (const p of sync.slice(0, 30)) {
    console.log(`  ${(p.name || "").padEnd(40)} ${(p.label || "").padEnd(38)} ${p.type}`);
  }

  // Save full list
  const fs = await import("fs");
  fs.writeFileSync("scripts/hubspot-product-properties.json", JSON.stringify({
    pulled_at: new Date().toISOString(),
    total: props.length,
    spec_candidates: candidates,
    by_group: Object.fromEntries(byGroup),
    all: props,
  }, null, 2));
  console.log(`\nWrote scripts/hubspot-product-properties.json`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
