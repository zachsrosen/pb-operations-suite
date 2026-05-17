#!/usr/bin/env node
/**
 * Smoke-test the PE PandaDoc multi-template-id search against the prod key.
 *
 * Usage:
 *   node --env-file=.env scripts/test-pe-pandadoc-search.mjs
 *
 * Edit DEAL_ID + CUSTOMER_LAST_NAME below to test other deals.
 */

const DEAL_ID = "57596163961";
const CUSTOMER_LAST_NAME = "Brownell";

// Mirror the production env-var-driven template ID lists. Each category
// supports multiple IDs (comma-separated in the actual env var).
const TEMPLATE_IDS = {
  attestation: [
    "mZPZsBczPK65rUAQS4C3VP", // pulled from actual Brownell doc
    "P6SEpDhmYhGF94dSGZCNQf", // PandaDoc UI "Installer Attestation"
  ],
  acceptance: [
    "vGtGtLGEX6HrnCQ7ZrVPbK", // pulled from actual Brownell doc
    "v6HgjDG4msDxBph64NrX5d", // PandaDoc UI "Customer Certificate of Acceptance"
  ],
  progress_waiver: [
    "JS88bcE68fzhMN4bTFmY2T", // pulled from actual Brownell doc (Syn Cash Old folder)
    "i8o6oJ7mcafGs2EKawvjXD", // PandaDoc UI "PE Conditional Progress Lien Waiver"
  ],
  final_waiver: [
    "ARytSraxHf7kVFfFckWoJP", // pulled from actual Brownell doc
    "YYLRaAdD3trq2WZuqYs4cD", // PandaDoc UI "Conditional Waiver and Release on Final Payment"
  ],
};

const DOC_NAME_PREFIXES = {
  attestation: "PE Installer Attestation",
  acceptance: "PE Customer Certificate of Acceptance",
  progress_waiver: "PE Conditional Progress Lien Waiver",
  final_waiver: "PE Conditional Waiver and Release on Final Payment",
};

const key = process.env.PANDADOC_API_KEY;
if (!key) {
  console.error("PANDADOC_API_KEY not set");
  process.exit(1);
}

async function pandaFetch(path, params = {}) {
  const url = new URL(`https://api.pandadoc.com/public/v1${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `API-Key ${key}` },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${url.pathname}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

for (const [cat, ids] of Object.entries(TEMPLATE_IDS)) {
  console.log(`\n=== ${cat} ===`);
  const prefix = DOC_NAME_PREFIXES[cat];
  let foundDoc = null;
  let foundVia = null;

  // Strategy 1: each template + deal metadata
  for (const tplId of ids) {
    if (foundDoc) break;
    const data = await pandaFetch("/documents", {
      template_id: tplId,
      "metadata_hubspot.deal_id": DEAL_ID,
      count: 1,
      order_by: "-date_modified",
    });
    console.log(`  S1 tpl=${tplId.slice(0, 8)}: ${data.results?.length ?? 0} results`);
    if (data.results?.[0]) {
      foundDoc = data.results[0];
      foundVia = `S1/template=${tplId.slice(0, 8)}`;
    }
  }

  // Strategy 2: each template + name search
  if (!foundDoc) {
    for (const tplId of ids) {
      if (foundDoc) break;
      const data = await pandaFetch("/documents", {
        template_id: tplId,
        q: `${prefix} - ${CUSTOMER_LAST_NAME}`,
        count: 3,
      });
      console.log(`  S2 tpl=${tplId.slice(0, 8)}: ${data.results?.length ?? 0} results`);
      if (data.results?.[0]) {
        foundDoc = data.results[0];
        foundVia = `S2/template=${tplId.slice(0, 8)}`;
      }
    }
  }

  // Strategy 3: prefix-only, filter for customer
  if (!foundDoc) {
    const data = await pandaFetch("/documents", { q: prefix, count: 20 });
    const filtered = (data.results ?? []).filter((d) =>
      d.name.toLowerCase().includes(CUSTOMER_LAST_NAME.toLowerCase())
    );
    console.log(`  S3 prefix-only: ${data.results?.length ?? 0} total, ${filtered.length} matched customer`);
    if (filtered[0]) {
      foundDoc = filtered[0];
      foundVia = "S3/prefix+customer";
    }
  }

  // Strategy 4: each template + client-side customer filter
  if (!foundDoc) {
    for (const tplId of ids) {
      if (foundDoc) break;
      const data = await pandaFetch("/documents", {
        template_id: tplId,
        count: 50,
        order_by: "-date_modified",
      });
      const filtered = (data.results ?? []).filter((d) =>
        d.name.toLowerCase().includes(CUSTOMER_LAST_NAME.toLowerCase())
      );
      console.log(`  S4 tpl=${tplId.slice(0, 8)}: ${data.results?.length ?? 0} total, ${filtered.length} matched`);
      if (filtered[0]) {
        foundDoc = filtered[0];
        foundVia = `S4/template=${tplId.slice(0, 8)}+customer`;
      }
    }
  }

  if (foundDoc) {
    console.log(`  ✅ MATCH via ${foundVia}`);
    console.log(`     name: "${foundDoc.name}"`);
    console.log(`     id: ${foundDoc.id}`);
    console.log(`     status: ${foundDoc.status}`);
  } else {
    console.log(`  ❌ NO MATCH across all 4 strategies`);
  }
}
