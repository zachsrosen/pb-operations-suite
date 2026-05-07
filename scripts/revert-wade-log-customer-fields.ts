/**
 * Undo the customerPhone/customerAddress backfill on Wade Markland's call
 * log row — the log should reflect only what the electrician actually
 * typed. The HubSpot contact association (hubspotContactId) and the
 * existing ticket→contact link both stay in place.
 *
 *   npx tsx scripts/revert-wade-log-customer-fields.ts          # dry-run
 *   npx tsx scripts/revert-wade-log-customer-fields.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "45171950925";

async function main() {
  const apply = process.argv.includes("--apply");
  const log = await prisma.onCallCallLog.findFirst({ where: { hubspotTicketId: TICKET_ID } });
  if (!log) { console.error("No call log row found"); process.exit(1); }
  console.log(`\nCall log ${log.id}: ${log.customerName}`);
  console.log(`  customerPhone   = ${log.customerPhone}`);
  console.log(`  customerAddress = ${log.customerAddress}`);
  console.log(`  hubspotContactId = ${log.hubspotContactId}  (will keep)`);

  if (!apply) {
    console.log("\n=== Plan (dry-run) ===");
    console.log("  - Set customerPhone = null");
    console.log("  - Set customerAddress = null");
    console.log("  - Leave hubspotContactId in place");
    console.log("\n(Re-run with --apply to execute.)");
    return;
  }

  const updated = await prisma.onCallCallLog.update({
    where: { id: log.id },
    data: { customerPhone: null, customerAddress: null },
  });
  console.log(`\n  ✓ reverted`);
  console.log(`    customerPhone   = ${updated.customerPhone}`);
  console.log(`    customerAddress = ${updated.customerAddress}`);
  console.log(`    hubspotContactId = ${updated.hubspotContactId}  (still linked)`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
