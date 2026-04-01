import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaNeon } = await import("@prisma/adapter-neon");

  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const allIPs = await prisma.internalProduct.findMany({
    where: { isActive: true },
    select: { id: true, category: true, brand: true, model: true, name: true, zuperItemId: true },
    orderBy: [{ category: "asc" }, { brand: "asc" }, { model: "asc" }],
  });

  // Flag ugly names
  const issues: Array<{ id: string; category: string; brand: string; model: string; name: string | null; problems: string[] }> = [];

  for (const ip of allIPs) {
    const problems: string[] = [];
    const displayName = ip.name || `${ip.brand} ${ip.model}`;

    // ALL CAPS brand or model
    if (ip.brand === ip.brand.toUpperCase() && ip.brand.length > 3 && !/^(SMA|REC|LG|AEE|SEG|SVC|D&R)$/.test(ip.brand)) {
      problems.push(`ALL CAPS brand: "${ip.brand}"`);
    }
    if (ip.model === ip.model.toUpperCase() && ip.model.length > 8) {
      problems.push(`ALL CAPS model: "${ip.model}"`);
    }

    // Part numbers in parens as model
    if (/\(\d+.*\)/.test(ip.model)) {
      problems.push(`Part number in parens in model: "${ip.model}"`);
    }

    // "SVC" as brand
    if (ip.brand === "SVC") {
      problems.push(`Brand is "SVC" — should be actual brand`);
    }

    // Generic brand with long model
    if (ip.brand === "Generic" && ip.model.length > 30) {
      problems.push(`Generic brand with long model: "${ip.model.substring(0, 50)}"`);
    }

    // Name field weirdness
    if (ip.name && ip.name !== `${ip.brand} ${ip.model}`) {
      // Name doesn't match brand+model — might be fine, but flag if ugly
      if (ip.name === ip.name.toUpperCase() && ip.name.length > 10) {
        problems.push(`ALL CAPS name: "${ip.name}"`);
      }
    }

    // Brand has extra spaces or weird chars
    if (ip.brand.includes("  ") || ip.model.includes("  ")) {
      problems.push("Double spaces in brand/model");
    }

    // Model looks like it has brand repeated
    if (ip.model.toLowerCase().startsWith(ip.brand.toLowerCase()) && ip.brand.length > 2) {
      problems.push(`Model starts with brand: "${ip.brand}" + "${ip.model}"`);
    }

    if (problems.length > 0) {
      issues.push({ id: ip.id, category: ip.category, brand: ip.brand, model: ip.model, name: ip.name, problems });
    }
  }

  console.log(`Total active IPs: ${allIPs.length}`);
  console.log(`IPs with naming issues: ${issues.length}\n`);

  // Group by issue type
  const byProblem = new Map<string, number>();
  for (const ip of issues) {
    for (const p of ip.problems) {
      const key = p.split(":")[0];
      byProblem.set(key, (byProblem.get(key) || 0) + 1);
    }
  }
  console.log("Issue breakdown:");
  for (const [k, v] of [...byProblem.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}x ${k}`);
  }

  console.log("\n--- ALL IPs WITH ISSUES ---\n");
  for (const ip of issues) {
    const display = ip.name || `${ip.brand} ${ip.model}`;
    console.log(`[${ip.category}] brand="${ip.brand}" model="${ip.model}"${ip.name ? ` name="${ip.name}"` : ""}`);
    console.log(`  Display: "${display}"`);
    console.log(`  Zuper: ${ip.zuperItemId ? "linked" : "NOT linked"}`);
    for (const p of ip.problems) {
      console.log(`  ⚠ ${p}`);
    }
    console.log();
  }

  // Also show a sample of GOOD names for comparison
  console.log("--- SAMPLE OF CLEAN NAMES (first 20) ---\n");
  const clean = allIPs.filter(ip => !issues.find(i => i.id === ip.id));
  for (const ip of clean.slice(0, 20)) {
    console.log(`  [${ip.category}] ${ip.brand} ${ip.model}`);
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
