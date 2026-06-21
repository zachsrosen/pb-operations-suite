/**
 * One-off: set `rtb_blocked_reason = "Pending Interconnection Approval."` on the
 * five RTB-Blocked deals that are blocked on interconnection approval.
 *
 * Usage (from a checkout with prod HubSpot creds in .env):
 *   source .env && tsx scripts/set-rtb-reason.ts          # dry run (prints plan)
 *   source .env && tsx scripts/set-rtb-reason.ts --apply  # actually writes
 *
 * Required env var:
 *   - HUBSPOT_ACCESS_TOKEN
 *
 * Writes one deal at a time via the CRM v3 PATCH endpoint. Safe to re-run
 * (idempotent — sets the same value).
 */

const REASON = "Pending Interconnection Approval.";

// dealId → label, for readable logging.
const DEALS: Record<string, string> = {
  "60055283846": "PROJ-9830 Perez",
  "59882258351": "PROJ-9834 Patschke",
  "58252025637": "PROJ-9642 Hodges",
  "52384370944": "PROJ-8941 Centeno",
  "43231526242": "PROJ-9866 Moses",
};

const PROPERTY = "rtb_blocked_reason";

async function main() {
  const apply = process.argv.includes("--apply");

  console.log(`${apply ? "APPLY" : "DRY RUN"} — set ${PROPERTY} = "${REASON}" on ${Object.keys(DEALS).length} deals\n`);

  if (!apply) {
    for (const [id, label] of Object.entries(DEALS)) {
      console.log(`  would update ${id}  (${label})`);
    }
    console.log("\nNo changes written. Re-run with --apply to commit.");
    return;
  }

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    console.error("✗ HUBSPOT_ACCESS_TOKEN is not set. Run with: source .env && tsx scripts/set-rtb-reason.ts --apply");
    process.exit(1);
  }

  let ok = 0;
  for (const [id, label] of Object.entries(DEALS)) {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { [PROPERTY]: REASON } }),
    });

    if (res.ok) {
      ok++;
      console.log(`  ✓ ${id}  (${label})`);
    } else {
      const body = await res.text().catch(() => "");
      console.error(`  ✗ ${id}  (${label}) — HTTP ${res.status} ${res.statusText} ${body}`);
    }
  }

  console.log(`\nDone: ${ok}/${Object.keys(DEALS).length} updated.`);
  if (ok < Object.keys(DEALS).length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
