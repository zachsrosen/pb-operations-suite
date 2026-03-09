/**
 * Seed SOP Guide from static HTML into database.
 *
 * Usage:
 *   npx tsx scripts/seed-sop.ts              # Init-only: skip existing sections
 *   npx tsx scripts/seed-sop.ts --force      # Overwrite all content (dev only)
 *
 * Safety:
 *   - Default mode only INSERTs missing tabs/sections (never overwrites edits)
 *   - --force overwrites content but REFUSES in production unless --confirm-production
 *   - Idempotent: safe to rerun
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Run: source .env && npx tsx scripts/seed-sop.ts");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const CONFIRM_PROD = args.includes("--confirm-production");

if (FORCE && process.env.NODE_ENV === "production" && !CONFIRM_PROD) {
  console.error("ERROR: --force in production requires --confirm-production flag");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse HTML
// ---------------------------------------------------------------------------
const htmlPath = path.resolve(__dirname, "../public/sop-guide.html");
const html = fs.readFileSync(htmlPath, "utf-8");
const $ = cheerio.load(html);

// ---------------------------------------------------------------------------
// 1. Extract tabs from tab bar buttons
// ---------------------------------------------------------------------------
interface TabDef {
  id: string;
  label: string;
  sortOrder: number;
}

const tabs: TabDef[] = [];
$("#tabBar button").each((i, el) => {
  const onclick = $(el).attr("onclick") || "";
  const match = onclick.match(/switchTab\('([^']+)'\)/);
  if (match) {
    tabs.push({
      id: match[1],
      label: $(el).text().trim(),
      sortOrder: i,
    });
  }
});

console.log(`Found ${tabs.length} tabs: ${tabs.map((t) => t.id).join(", ")}`);

// ---------------------------------------------------------------------------
// 2. Extract sidebar sections → section metadata
// ---------------------------------------------------------------------------
interface SectionMeta {
  id: string;
  tabId: string;
  sidebarGroup: string;
  title: string;
  dotColor: string;
  sortOrder: number;
}

const sectionMetas: SectionMeta[] = [];
let globalSort = 0;

$(".sidebar-section").each((_i, sectionEl) => {
  const tabId = $(sectionEl).attr("data-tab") || "";
  const groupTitle = $(sectionEl).find(".sidebar-section-title").first().text().trim();

  $(sectionEl)
    .find("a[data-s]")
    .each((_j, linkEl) => {
      const sectionId = $(linkEl).attr("data-s") || "";
      const title = $(linkEl).text().trim();

      // Extract dot color from class like "dot-green", "dot-amber"
      const dotSpan = $(linkEl).find(".dot");
      const dotClass = (dotSpan.attr("class") || "").split(" ").find((c) => c.startsWith("dot-"));
      const dotColor = dotClass ? dotClass.replace("dot-", "") : "blue";

      if (sectionId && tabId) {
        sectionMetas.push({
          id: sectionId,
          tabId,
          sidebarGroup: groupTitle,
          title,
          dotColor,
          sortOrder: globalSort++,
        });
      }
    });
});

console.log(`Found ${sectionMetas.length} sidebar links across ${tabs.length} tabs`);

// ---------------------------------------------------------------------------
// 3. Extract section content from <div class="section" id="...">
// ---------------------------------------------------------------------------
interface SectionContent {
  id: string;
  innerHTML: string;
}

const sectionContents: SectionContent[] = [];

$(".section").each((_i, el) => {
  const id = $(el).attr("id");
  if (!id) return;

  // Get innerHTML and convert cross-section links
  let innerHTML = $(el).html() || "";

  // Convert onclick="go('section-id')" to data-sop-link="section-id"
  innerHTML = innerHTML.replace(
    /href="#"\s*onclick="go\('([^']+)'\)"/g,
    'href="#" data-sop-link="$1"'
  );

  // Also handle onclick with double quotes inside
  innerHTML = innerHTML.replace(
    /href="#"\s*onclick='go\("([^"]+)"\)'/g,
    'href="#" data-sop-link="$1"'
  );

  sectionContents.push({ id, innerHTML: innerHTML.trim() });
});

console.log(`Found ${sectionContents.length} content sections`);

// ---------------------------------------------------------------------------
// 4. Match sidebar metadata with content
// ---------------------------------------------------------------------------
const contentMap = new Map(sectionContents.map((s) => [s.id, s.innerHTML]));

// Check for sections in sidebar but not in content (or vice versa)
const sidebarIds = new Set(sectionMetas.map((s) => s.id));
const contentIds = new Set(sectionContents.map((s) => s.id));

for (const id of sidebarIds) {
  if (!contentIds.has(id)) {
    console.warn(`WARNING: Sidebar link "${id}" has no matching content section`);
  }
}
for (const id of contentIds) {
  if (!sidebarIds.has(id)) {
    console.warn(`WARNING: Content section "${id}" has no sidebar link (orphan)`);
  }
}

// ---------------------------------------------------------------------------
// 5. Seed database
// ---------------------------------------------------------------------------
async function seed() {
  console.log(`\nSeeding ${FORCE ? "(FORCE mode - overwriting)" : "(init-only - skip existing)"}...\n`);

  // Upsert tabs
  for (const tab of tabs) {
    if (FORCE) {
      await prisma.sopTab.upsert({
        where: { id: tab.id },
        create: { id: tab.id, label: tab.label, sortOrder: tab.sortOrder },
        update: { label: tab.label, sortOrder: tab.sortOrder },
      });
    } else {
      const existing = await prisma.sopTab.findUnique({ where: { id: tab.id } });
      if (!existing) {
        await prisma.sopTab.create({
          data: { id: tab.id, label: tab.label, sortOrder: tab.sortOrder },
        });
        console.log(`  + Tab: ${tab.id} (${tab.label})`);
      } else {
        console.log(`  = Tab: ${tab.id} (exists, skipping)`);
      }
    }
  }

  // Upsert sections
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const meta of sectionMetas) {
    const content = contentMap.get(meta.id) || `<p>Section "${meta.id}" — content pending.</p>`;

    if (FORCE) {
      await prisma.sopSection.upsert({
        where: { id: meta.id },
        create: {
          id: meta.id,
          tabId: meta.tabId,
          sidebarGroup: meta.sidebarGroup,
          title: meta.title,
          dotColor: meta.dotColor,
          sortOrder: meta.sortOrder,
          content,
          version: 1,
        },
        update: {
          tabId: meta.tabId,
          sidebarGroup: meta.sidebarGroup,
          title: meta.title,
          dotColor: meta.dotColor,
          sortOrder: meta.sortOrder,
          content,
          // Don't reset version on force — keep existing version counter
        },
      });
      updated++;
    } else {
      const existing = await prisma.sopSection.findUnique({ where: { id: meta.id } });
      if (!existing) {
        await prisma.sopSection.create({
          data: {
            id: meta.id,
            tabId: meta.tabId,
            sidebarGroup: meta.sidebarGroup,
            title: meta.title,
            dotColor: meta.dotColor,
            sortOrder: meta.sortOrder,
            content,
            version: 1,
          },
        });
        created++;
        console.log(`  + Section: ${meta.id} (${meta.title})`);
      } else {
        skipped++;
      }
    }
  }

  if (FORCE) {
    console.log(`\n  Updated ${updated} sections (force mode)`);
  } else {
    console.log(`\n  Created: ${created}, Skipped (already exist): ${skipped}`);
  }

  // Summary
  const tabCount = await prisma.sopTab.count();
  const sectionCount = await prisma.sopSection.count();
  console.log(`\nDatabase totals: ${tabCount} tabs, ${sectionCount} sections`);
}

seed()
  .then(() => {
    console.log("\nSeed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
