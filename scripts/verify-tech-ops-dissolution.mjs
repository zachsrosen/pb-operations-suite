#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

function sh(cmd) {
  const result = spawnSync("bash", ["-lc", cmd], { encoding: "utf8" });
  return {
    code: result.status ?? 1,
    out: (result.stdout || "").trim(),
    err: (result.stderr || "").trim(),
  };
}

function listDashboardRoutes(rootDir) {
  const dashboardsDir = join(rootDir, "src", "app", "dashboards");
  const routes = [];

  function walk(dir, rel = "") {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, nextRel);
      } else if (entry.isFile() && entry.name === "page.tsx") {
        const routeDir = rel;
        if (routeDir.length > 0) routes.push(`/dashboards/${routeDir}`);
      }
    }
  }

  walk(dashboardsDir);
  return routes.sort();
}

function listSuiteMapKeys(rootDir) {
  const file = readFileSync(join(rootDir, "src", "components", "DashboardShell.tsx"), "utf8");
  const matches = file.match(/"\/dashboards\/[^"]+"\s*:/g) || [];
  return matches.map((m) => m.replace(/\s*:.*/, "").replaceAll('"', "")).sort();
}

function printSection(title) {
  console.log(`\n## ${title}`);
}

function printList(label, items) {
  console.log(`${label}: ${items.length}`);
  for (const item of items) console.log(`- ${item}`);
}

function contains(pattern, text) {
  return new RegExp(pattern, "m").test(text);
}

function checkHubSpotLeadWiring(rootDir) {
  const text = readFileSync(join(rootDir, "src", "lib", "hubspot.ts"), "utf8");
  const checks = [
    { name: "DEAL_PROPERTIES includes design", ok: contains(/"design"/.source, text) },
    { name: "DEAL_PROPERTIES includes permit_tech", ok: contains(/"permit_tech"/.source, text) },
    { name: "DEAL_PROPERTIES includes interconnections_tech", ok: contains(/"interconnections_tech"/.source, text) },
    { name: "Project interface includes designLead", ok: contains(/\bdesignLead:\s*string/.source, text) },
    { name: "Project interface includes permitLead", ok: contains(/\bpermitLead:\s*string/.source, text) },
    { name: "Project interface includes interconnectionsLead", ok: contains(/\binterconnectionsLead:\s*string/.source, text) },
    { name: "transformDealToProject sets designLead", ok: contains(/\bdesignLead:\s*\(\(\)\s*=>/.source, text) },
    { name: "transformDealToProject sets permitLead", ok: contains(/\bpermitLead:\s*\(\(\)\s*=>/.source, text) },
    { name: "transformDealToProject sets interconnectionsLead", ok: contains(/\binterconnectionsLead:\s*\(\(\)\s*=>/.source, text) },
    { name: "buildOwnerMap fetches design property definition", ok: contains(/getDealPropertyDefinition\("design"/.source, text) },
    { name: "buildOwnerMap fetches permit_tech property definition", ok: contains(/getDealPropertyDefinition\("permit_tech"/.source, text) },
    { name: "buildOwnerMap fetches interconnections_tech property definition", ok: contains(/getDealPropertyDefinition\("interconnections_tech"/.source, text) },
    { name: "buildOwnerMap fetches archived design definition", ok: contains(/getDealPropertyDefinition\("design",\s*true\)/.source, text) },
    { name: "buildOwnerMap fetches archived permit_tech definition", ok: contains(/getDealPropertyDefinition\("permit_tech",\s*true\)/.source, text) },
    { name: "buildOwnerMap fetches archived interconnections_tech definition", ok: contains(/getDealPropertyDefinition\("interconnections_tech",\s*true\)/.source, text) },
  ];

  printSection("HubSpot Lead Wiring");
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}: ${check.name}`);
  }
}

function main() {
  const rootDir = process.cwd();

  printSection("Tech Ops / Department References In src/");
  const refScan = sh(`rg -n "suites/department|Tech Ops|Department Suite" src`);
  if (refScan.code === 0 && refScan.out) {
    const lines = refScan.out.split("\n");
    console.log(`Found ${lines.length} reference(s):`);
    for (const line of lines) console.log(line);
  } else {
    console.log("No references found.");
  }

  printSection("SUITE_MAP Coverage");
  const dashboardRoutes = listDashboardRoutes(rootDir);
  const suiteMapKeys = listSuiteMapKeys(rootDir);
  const missing = dashboardRoutes.filter((route) => !suiteMapKeys.includes(route));
  const extra = suiteMapKeys.filter((route) => !dashboardRoutes.includes(route));
  printList("Dashboard page routes", dashboardRoutes);
  printList("SUITE_MAP keys", suiteMapKeys);
  printList("Missing SUITE_MAP entries", missing);
  printList("Extra SUITE_MAP entries", extra);

  printSection("ExtendedProject Definitions");
  const extScan = sh(`rg -n "interface ExtendedProject extends RawProject" src/app/dashboards -g"*.tsx"`);
  if (extScan.code === 0 && extScan.out) {
    const lines = extScan.out.split("\n");
    console.log(`Found ${lines.length} file(s) with ExtendedProject:`);
    for (const line of lines) console.log(line);
  } else {
    console.log("No ExtendedProject definitions found.");
  }

  printSection("Role Route Checks (TECH_OPS / DESIGNER / PERMITTING)");
  const roles = sh(`rg -n "TECH_OPS:|DESIGNER:|PERMITTING:|/suites/department|/suites/operations|/dashboards/site-survey|/dashboards/construction|/dashboards/inspections|/dashboards/incentives" src/lib/role-permissions.ts src/lib/suite-nav.ts`);
  console.log(roles.out || "No matching role route lines found.");

  checkHubSpotLeadWiring(rootDir);
}

main();
