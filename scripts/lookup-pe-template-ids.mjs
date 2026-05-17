#!/usr/bin/env node
/**
 * One-off helper to extract the 4 PE PandaDoc template IDs from 4 known documents.
 *
 * Usage:
 *   1. Make sure your terminal has PANDADOC_API_KEY in env (or run with
 *      `node --env-file=.env scripts/lookup-pe-template-ids.mjs`)
 *   2. Edit the DOC_IDS map below with the 4 document IDs you have.
 *   3. node --env-file=.env scripts/lookup-pe-template-ids.mjs
 *
 * Output: paste the resulting template IDs into Vercel as env vars:
 *   PANDADOC_PE_ATTESTATION_TEMPLATE_ID
 *   PANDADOC_PE_ACCEPTANCE_TEMPLATE_ID
 *   PANDADOC_PE_PROGRESS_WAIVER_TEMPLATE_ID
 *   PANDADOC_PE_FINAL_WAIVER_TEMPLATE_ID
 */

const DOC_IDS = {
  attestation: "pduECfkphoZkiP9XP53b98",
  acceptance: "pYMW3dkNAs7roFiLfkcD5o",
  progress_waiver: "zpHFxpVFMQDsDJVbEpfUy2",
  final_waiver: "ZjCzEM8SW3QtPxBZFWTTgW",
};

const ENV_VAR_NAMES = {
  attestation: "PANDADOC_PE_ATTESTATION_TEMPLATE_ID",
  acceptance: "PANDADOC_PE_ACCEPTANCE_TEMPLATE_ID",
  progress_waiver: "PANDADOC_PE_PROGRESS_WAIVER_TEMPLATE_ID",
  final_waiver: "PANDADOC_PE_FINAL_WAIVER_TEMPLATE_ID",
};

const key = process.env.PANDADOC_API_KEY;
if (!key) {
  console.error("PANDADOC_API_KEY not set. Run with: node --env-file=.env scripts/lookup-pe-template-ids.mjs");
  process.exit(1);
}

console.log("Looking up template IDs for 4 PE documents...\n");

const results = {};
for (const [pe_key, doc_id] of Object.entries(DOC_IDS)) {
  const res = await fetch(`https://api.pandadoc.com/public/v1/documents/${doc_id}/details`, {
    headers: { Authorization: `API-Key ${key}` },
  });
  if (!res.ok) {
    console.error(`  ${pe_key}: HTTP ${res.status} — ${await res.text().then(t => t.slice(0, 200))}`);
    continue;
  }
  const d = await res.json();
  const tplId = d.template_id ?? d.template?.id ?? null;
  results[pe_key] = { name: d.name, templateId: tplId };
  console.log(`  ${pe_key.padEnd(16)} doc="${d.name}"`);
  console.log(`  ${" ".repeat(16)} template_id=${tplId ?? "MISSING"}`);
  console.log("");
}

console.log("\n--- Vercel env vars to set ---\n");
for (const [pe_key, info] of Object.entries(results)) {
  if (info.templateId) {
    console.log(`${ENV_VAR_NAMES[pe_key]}=${info.templateId}`);
  }
}
console.log("\nTo set in Vercel:");
for (const [pe_key, info] of Object.entries(results)) {
  if (info.templateId) {
    console.log(`  printf '%s' '${info.templateId}' | vercel env add ${ENV_VAR_NAMES[pe_key]} production --scope tech-ops`);
  }
}
