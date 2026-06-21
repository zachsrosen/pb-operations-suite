/**
 * Store Vishtik portal credentials in SystemConfig for the nightly cron.
 * Needed because the Vercel env store is full, so creds can't live there (same
 * reason Enphase/EagleView tokens live in SystemConfig). The client reads
 * `vishtik_username` / `vishtik_password` from SystemConfig when env is unset.
 *
 * Reads the values from the ENVIRONMENT (never hardcoded / never an arg), so
 * the password stays out of shell history when run inline:
 *
 *   cd /tmp/pb-vishtik-id-sync   (or the repo root)
 *   VISHTIK_PASSWORD='...' npx tsx scripts/set-vishtik-creds.ts
 *
 * VISHTIK_USERNAME is already in .env; pass VISHTIK_PASSWORD inline.
 * WARNING: writes to whatever DATABASE_URL points at — that's prod.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

(async () => {
  const user = process.env.VISHTIK_USERNAME;
  const pass = process.env.VISHTIK_PASSWORD;
  if (!user || !pass) {
    console.error("Set VISHTIK_USERNAME and VISHTIK_PASSWORD in the environment first.");
    process.exit(1);
  }
  const { prisma } = await import("@/lib/db");
  if (!prisma) {
    console.error("No DATABASE_URL / prisma client available.");
    process.exit(1);
  }
  for (const [key, value] of [
    ["vishtik_username", user],
    ["vishtik_password", pass],
  ] as const) {
    await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ["vishtik_username", "vishtik_password"] } },
  });
  for (const r of rows) {
    const shown = r.key.includes("password") ? "*".repeat(8) : r.value;
    console.log(`✓ ${r.key} = ${shown} (length ${r.value.length})`);
  }
  console.log("done — creds stored in SystemConfig.");
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e?.message || String(e));
  process.exit(1);
});
