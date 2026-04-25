/**
 * Probe Zuper to find the API endpoint for defining custom fields on Product.
 *
 * Read-only — no creates. Tries common Zuper admin endpoints and reports
 * what's accessible. The goal is to find an endpoint that lets us programmatically
 * create the 15 custom fields rather than asking ops to define them by hand
 * in the Zuper admin UI.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_zuper-custom-field-probe.ts
 */
const API_KEY = process.env.ZUPER_API_KEY;
const API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
if (!API_KEY) {
  console.error("ZUPER_API_KEY not set");
  process.exit(1);
}

const PROBES = [
  "/customField",
  "/custom_field",
  "/customfields",
  "/custom_fields",
  "/customField/PRODUCT",
  "/customField?module=PRODUCT",
  "/customField?module_name=PRODUCT",
  "/customFields?module=PRODUCT",
  "/customfield?module_name=PRODUCT",
  "/metafield",
  "/metafield/PRODUCT",
  "/property",
  "/properties",
  "/admin/customFields",
];

async function probe(path: string): Promise<{ ok: boolean; status: number; sample?: unknown; error?: string }> {
  try {
    const r = await fetch(`${API_URL}${path}`, {
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
    });
    const t = await r.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(t); } catch { /* not json */ }
    if (r.ok) {
      // Sample first record + total
      const arr = (parsed as { data?: unknown[]; results?: unknown[] })?.data
        || (parsed as { data?: unknown[]; results?: unknown[] })?.results
        || (Array.isArray(parsed) ? parsed : null);
      const count = Array.isArray(arr) ? arr.length : "n/a";
      return { ok: true, status: r.status, sample: { count, first: Array.isArray(arr) ? arr[0] : parsed } };
    }
    return { ok: false, status: r.status, error: t.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log("Probing Zuper for custom-field admin endpoints...\n");
  for (const p of PROBES) {
    const r = await probe(p);
    const marker = r.ok ? "✓" : "✗";
    console.log(`  ${marker} ${String(r.status).padStart(3)}  ${p}`);
    if (r.ok) {
      const s = JSON.stringify(r.sample, null, 2);
      console.log(s.split("\n").slice(0, 25).map((l) => "        " + l).join("\n"));
      console.log("");
    }
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
