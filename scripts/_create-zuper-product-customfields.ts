/**
 * Create the 15 Zuper Product custom fields per
 * docs/superpowers/specs/2026-04-24-catalog-sync-external-mappings.md § 2.
 *
 * Strategy: Zuper auto-registers a field the first time you write a meta_data
 * entry with that label on any product. We write all 15 entries to a single
 * "anchor" product (the Tesla Powerwall 3 Expansion Pack used in earlier
 * probes) with placeholder values. Once registered, the field shows in
 * Zuper admin/UI and the M3.4 plumbing can populate real values on subsequent
 * syncs.
 *
 * Also cleans up a leftover probe entry from _zuper-test-implicit-cf.ts.
 *
 * Idempotent — checks existing meta_data labels first; only adds missing ones.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_create-zuper-product-customfields.ts [--dry-run]
 */
const API_KEY = process.env.ZUPER_API_KEY;
const API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
if (!API_KEY) { console.error("ZUPER_API_KEY missing"); process.exit(1); }

const DRY_RUN = process.argv.includes("--dry-run");
const ANCHOR_PRODUCT_ID = process.argv.find((a) => a.startsWith("--product="))?.split("=")[1];

// Probe leftover to delete
const PROBE_LABEL_TO_DELETE = "PB Test Field With Explicit Label";

interface FieldSpec {
  internalKey: string;       // FieldDef.key in catalog-fields.ts
  label: string;             // Zuper-visible
  apiKey: string;            // proposed snake_case for catalog-fields.ts zuperCustomField
  type: "SINGLE_LINE" | "NUMBER" | "DROPDOWN";
  options?: string[];
  placeholder: string;       // value to register the field — string per Zuper meta_data convention
  appliesTo: string[];
}

const FIELDS: FieldSpec[] = [
  // MODULE
  { internalKey: "wattage",         label: "Module Wattage (W)",          apiKey: "pb_module_wattage",         type: "NUMBER",     placeholder: "", appliesTo: ["MODULE"] },
  { internalKey: "efficiency",      label: "Module Efficiency (%)",       apiKey: "pb_module_efficiency_pct",  type: "NUMBER",     placeholder: "", appliesTo: ["MODULE"] },
  { internalKey: "cellType",        label: "Module Cell Type",            apiKey: "pb_module_cell_type",       type: "DROPDOWN",   options: ["Mono PERC", "TOPCon", "HJT", "Poly", "Thin Film"], placeholder: "", appliesTo: ["MODULE"] },
  { internalKey: "voc",             label: "Module Voc (V)",              apiKey: "pb_module_voc_v",           type: "NUMBER",     placeholder: "", appliesTo: ["MODULE"] },
  { internalKey: "isc",             label: "Module Isc (A)",              apiKey: "pb_module_isc_a",           type: "NUMBER",     placeholder: "", appliesTo: ["MODULE"] },
  // INVERTER
  { internalKey: "acOutputKw",      label: "Inverter AC Output (kW)",     apiKey: "pb_inverter_ac_output_kw",  type: "NUMBER",     placeholder: "", appliesTo: ["INVERTER"] },
  { internalKey: "phase",           label: "Inverter Phase",              apiKey: "pb_inverter_phase",         type: "DROPDOWN",   options: ["Single", "Three-phase"], placeholder: "", appliesTo: ["INVERTER"] },
  { internalKey: "inverterType",    label: "Inverter Type",               apiKey: "pb_inverter_type",          type: "DROPDOWN",   options: ["String", "Micro", "Hybrid", "Central"], placeholder: "", appliesTo: ["INVERTER"] },
  { internalKey: "mpptChannels",    label: "Inverter MPPT Channels",      apiKey: "pb_inverter_mppt_channels", type: "NUMBER",     placeholder: "", appliesTo: ["INVERTER"] },
  // BATTERY (also BATTERY_EXPANSION)
  { internalKey: "capacityKwh",     label: "Battery Capacity (kWh)",      apiKey: "pb_battery_capacity_kwh",   type: "NUMBER",     placeholder: "", appliesTo: ["BATTERY", "BATTERY_EXPANSION"] },
  { internalKey: "chemistry",       label: "Battery Chemistry",           apiKey: "pb_battery_chemistry",      type: "DROPDOWN",   options: ["LFP", "NMC"], placeholder: "", appliesTo: ["BATTERY", "BATTERY_EXPANSION"] },
  { internalKey: "continuousPowerKw", label: "Battery Continuous Power (kW)", apiKey: "pb_battery_continuous_kw", type: "NUMBER",  placeholder: "", appliesTo: ["BATTERY", "BATTERY_EXPANSION"] },
  // EV_CHARGER
  { internalKey: "connectorType",   label: "EV Charger Connector",        apiKey: "pb_evcharger_connector",    type: "DROPDOWN",   options: ["J1772", "NACS", "CCS"], placeholder: "", appliesTo: ["EV_CHARGER"] },
  { internalKey: "level",           label: "EV Charger Level",            apiKey: "pb_evcharger_level",        type: "DROPDOWN",   options: ["Level 1", "Level 2", "DC Fast"], placeholder: "", appliesTo: ["EV_CHARGER"] },
  // RACKING
  { internalKey: "roofAttachment",  label: "Racking Roof Attachment",     apiKey: "pb_racking_roof_type",      type: "DROPDOWN",   options: ["Comp Shingle", "Tile", "Metal", "S-Tile"], placeholder: "", appliesTo: ["RACKING"] },
];

interface MetaDataEntry {
  label?: string;
  value?: unknown;
  type?: string;
  hide_field?: boolean;
  hide_to_fe?: boolean;
  module_name?: string;
  _id?: string;
  options?: Array<{ label: string; value: string }> | string[];
}

async function pickAnchorProduct(): Promise<{ id: string; name?: string; meta_data: MetaDataEntry[] }> {
  if (ANCHOR_PRODUCT_ID) {
    const r = await fetch(`${API_URL}/product/${ANCHOR_PRODUCT_ID}`, {
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
    });
    if (!r.ok) throw new Error(`anchor fetch failed (${r.status})`);
    const d = await r.json();
    const p = d.data || d.product || d;
    return { id: p.product_uid || p.product_id || p.uid || p.id, name: p.product_name, meta_data: (p.meta_data || []) as MetaDataEntry[] };
  }
  const r = await fetch(`${API_URL}/product?count=1&page=1`, {
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  const d = await r.json();
  const p = (d.data || d.products || [])[0];
  if (!p) throw new Error("no products");
  // Need full meta_data → fetch detail
  const id = p.product_uid || p.product_id || p.uid || p.id;
  const det = await fetch(`${API_URL}/product/${id}`, {
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
  });
  const dd = await det.json();
  const full = dd.data || dd.product || dd;
  return { id, name: full.product_name, meta_data: (full.meta_data || []) as MetaDataEntry[] };
}

async function putProduct(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }> {
  const r = await fetch(`${API_URL}/product/${id}`, {
    method: "PUT",
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, body: text };
}

function buildMetaDataEntry(spec: FieldSpec): MetaDataEntry {
  const entry: MetaDataEntry = {
    label: spec.label,
    value: spec.placeholder,
    type: spec.type,
    hide_field: false,
    hide_to_fe: false,
    module_name: "PRODUCT",
  };
  if (spec.options && spec.options.length > 0) {
    entry.options = spec.options.map((v) => ({ label: v, value: v }));
  }
  return entry;
}

async function main() {
  console.log(`${DRY_RUN ? "DRY RUN — " : ""}Picking anchor product...`);
  const anchor = await pickAnchorProduct();
  console.log(`  using product ${anchor.id} (${anchor.name})`);
  console.log(`  ${anchor.meta_data.length} existing meta_data entries\n`);

  const existingLabels = new Set(anchor.meta_data.map((m) => (m.label || "").toLowerCase()));
  const toAdd = FIELDS.filter((f) => !existingLabels.has(f.label.toLowerCase()));
  const skipped = FIELDS.filter((f) => existingLabels.has(f.label.toLowerCase()));

  if (skipped.length > 0) {
    console.log(`Already on anchor (skipping):`);
    for (const f of skipped) console.log(`  = ${f.label}`);
    console.log();
  }

  // Cleanup: drop the leftover probe entry if present
  const cleanedMd = anchor.meta_data.filter((m) => (m.label || "") !== PROBE_LABEL_TO_DELETE);
  const probeFound = cleanedMd.length < anchor.meta_data.length;
  if (probeFound) {
    console.log(`Will REMOVE leftover probe entry "${PROBE_LABEL_TO_DELETE}"\n`);
  }

  if (toAdd.length === 0 && !probeFound) {
    console.log("Nothing to do — all 15 fields already present and no probe leftover.");
    return;
  }

  console.log(`Will ADD ${toAdd.length} fields:`);
  for (const f of toAdd) console.log(`  + ${f.label.padEnd(35)} ${f.type}${f.options ? ` [${f.options.length} opts]` : ""}`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — no PUT sent. Re-run without --dry-run to apply.");
    return;
  }

  // Build full meta_data array: cleaned existing + new entries
  const newEntries = toAdd.map(buildMetaDataEntry);
  const finalMd = [...cleanedMd, ...newEntries];

  console.log(`\nSending PUT with ${finalMd.length} meta_data entries (was ${anchor.meta_data.length}, ${probeFound ? "minus 1 probe entry, " : ""}plus ${newEntries.length} new)...`);
  const result = await putProduct(anchor.id, { product: { meta_data: finalMd } });
  if (!result.ok) {
    console.error(`✗ PUT failed (${result.status}): ${result.body.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✓ ${result.status} ${result.body.slice(0, 150)}`);

  console.log(`\nVerifying — re-reading product...`);
  const after = await pickAnchorProduct();
  const afterLabels = new Set(after.meta_data.map((m) => (m.label || "").toLowerCase()));
  const presentNow = FIELDS.filter((f) => afterLabels.has(f.label.toLowerCase()));
  const missing = FIELDS.filter((f) => !afterLabels.has(f.label.toLowerCase()));
  console.log(`  ${presentNow.length}/${FIELDS.length} fields present on anchor product.`);
  if (missing.length > 0) {
    console.log(`  Missing:`);
    for (const f of missing) console.log(`    ✗ ${f.label}`);
  }
  if (afterLabels.has(PROBE_LABEL_TO_DELETE.toLowerCase())) {
    console.log(`  ⚠ Probe entry still present (cleanup did not stick)`);
  } else if (probeFound) {
    console.log(`  ✓ Probe entry removed`);
  }

  // Also check whether the new fields appear globally on a different product
  console.log(`\nChecking field propagation: reading a different product's meta_data...`);
  const probe2 = await fetch(`${API_URL}/product?count=10&page=1`, {
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
  });
  const d2 = await probe2.json();
  const otherProducts = (d2.data || d2.products || []).filter((p: { product_uid?: string }) => p.product_uid !== anchor.id);
  if (otherProducts.length > 0) {
    const otherId = otherProducts[0].product_uid;
    const detRes = await fetch(`${API_URL}/product/${otherId}`, {
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
    });
    const detD = await detRes.json();
    const otherMd = ((detD.data || detD.product || detD).meta_data || []) as MetaDataEntry[];
    const otherLabels = new Set(otherMd.map((m) => (m.label || "").toLowerCase()));
    const onOther = FIELDS.filter((f) => otherLabels.has(f.label.toLowerCase()));
    console.log(`  ${onOther.length}/${FIELDS.length} new fields visible on a different product (${otherId})`);
    if (onOther.length === 0) {
      console.log(`  ℹ Fields are per-product, not global. Backfill needed to populate on existing products.`);
      console.log(`  ℹ For new products created via the M3.4 plumbing, the fields will appear automatically as values are written.`);
    } else if (onOther.length === FIELDS.length) {
      console.log(`  ✓ Fields propagated globally — visible on other products.`);
    }
  }

  // Persist mapping for activation step
  const fs = await import("fs");
  fs.writeFileSync("scripts/zuper-product-customfields.json", JSON.stringify({
    created_at: new Date().toISOString(),
    anchor_product_id: anchor.id,
    fields: FIELDS.map((f) => ({
      internalKey: f.internalKey,
      label: f.label,
      apiKey: f.apiKey,
      type: f.type,
      options: f.options || null,
      categories: f.appliesTo,
    })),
  }, null, 2));
  console.log(`\nWrote scripts/zuper-product-customfields.json`);
  console.log(`\nNext step: edit src/lib/catalog-fields.ts to add zuperCustomField keys per the file above.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
