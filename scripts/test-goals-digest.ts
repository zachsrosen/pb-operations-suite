/**
 * Test script: renders and sends all 4 per-office goals digest emails
 * with mock data to zach@photonbrothers.com.
 *
 * Usage: npx tsx scripts/test-goals-digest.ts
 */

import "dotenv/config";
import { render } from "@react-email/components";
import { GoalsWeeklyDigest, type GoalLineItem, type GoalsWeeklyDigestProps } from "../src/emails/GoalsWeeklyDigest";
import { sendEmailMessage } from "../src/lib/email";

const RECIPIENT = "zach@photonbrothers.com";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Mock data per office
// ---------------------------------------------------------------------------

const MOCK_COMPANY: GoalLineItem[] = [
  { label: "Sales Closed",             current: 794000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 26, weekDelta: 312000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Surveys Completed",        current: 422000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 185000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Design Approvals",         current: 758000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 24, weekDelta: 276000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Permits Issued",           current: 615000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 20, weekDelta: 230000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Construction Completions", current: 438000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 198000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Inspections Passed",       current: 427000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 165000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "PTO Granted",              current: 359000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 12, weekDelta: 142000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "5-Star Reviews",           current: 3,       baseTarget: 55,      stretchTarget: 55,      percent: 5,  weekDelta: 2,       pace: "red",    inStretchZone: false, format: "count" },
];

interface OfficeMock {
  name: string;
  slug: string;
  goals: GoalLineItem[];
}

const OFFICES: OfficeMock[] = [
  {
    name: "Westminster",
    slug: "westminster",
    goals: [
      { label: "Sales Closed", current: 137000, baseTarget: 1000000, stretchTarget: 1100000, percent: 14, weekDelta: 55000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Surveys Completed", current: 109000, baseTarget: 1000000, stretchTarget: 1100000, percent: 11, weekDelta: 42000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Design Approvals", current: 281000, baseTarget: 1000000, stretchTarget: 1100000, percent: 28, weekDelta: 95000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "Permits Issued", current: 195000, baseTarget: 1000000, stretchTarget: 1100000, percent: 20, weekDelta: 68000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Construction Completions", current: 187000, baseTarget: 1000000, stretchTarget: 1100000, percent: 19, weekDelta: 72000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Inspections Passed", current: 104000, baseTarget: 1000000, stretchTarget: 1100000, percent: 10, weekDelta: 38000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "PTO Granted", current: 223000, baseTarget: 1000000, stretchTarget: 1100000, percent: 22, weekDelta: 85000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "5-Star Reviews", current: 1, baseTarget: 15, stretchTarget: 15, percent: 7, weekDelta: 1, pace: "red", inStretchZone: false, format: "count" },
    ],
  },
  {
    name: "Centennial",
    slug: "centennial",
    goals: [
      { label: "Sales Closed", current: 172000, baseTarget: 1000000, stretchTarget: 1100000, percent: 17, weekDelta: 68000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Surveys Completed", current: 188000, baseTarget: 1000000, stretchTarget: 1100000, percent: 19, weekDelta: 75000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Design Approvals", current: 305000, baseTarget: 1000000, stretchTarget: 1100000, percent: 31, weekDelta: 118000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "Permits Issued", current: 220000, baseTarget: 1000000, stretchTarget: 1100000, percent: 22, weekDelta: 85000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "Construction Completions", current: 144000, baseTarget: 1000000, stretchTarget: 1100000, percent: 14, weekDelta: 58000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Inspections Passed", current: 55000, baseTarget: 1000000, stretchTarget: 1100000, percent: 6, weekDelta: 22000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "PTO Granted", current: 60000, baseTarget: 1000000, stretchTarget: 1100000, percent: 6, weekDelta: 24000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "5-Star Reviews", current: 2, baseTarget: 15, stretchTarget: 15, percent: 13, weekDelta: 1, pace: "red", inStretchZone: false, format: "count" },
    ],
  },
  {
    name: "Colorado Springs",
    slug: "colorado-springs",
    goals: [
      { label: "Sales Closed", current: 83000, baseTarget: 400000, stretchTarget: 500000, percent: 21, weekDelta: 33000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "Surveys Completed", current: 45000, baseTarget: 400000, stretchTarget: 500000, percent: 11, weekDelta: 18000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Design Approvals", current: 0, baseTarget: 400000, stretchTarget: 500000, percent: 0, weekDelta: 0, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Permits Issued", current: 32000, baseTarget: 400000, stretchTarget: 500000, percent: 8, weekDelta: 15000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Construction Completions", current: 65000, baseTarget: 400000, stretchTarget: 500000, percent: 16, weekDelta: 26000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Inspections Passed", current: 0, baseTarget: 400000, stretchTarget: 500000, percent: 0, weekDelta: 0, pace: "red", inStretchZone: false, format: "currency" },
      { label: "PTO Granted", current: 0, baseTarget: 400000, stretchTarget: 500000, percent: 0, weekDelta: 0, pace: "red", inStretchZone: false, format: "currency" },
      { label: "5-Star Reviews", current: 0, baseTarget: 10, stretchTarget: 10, percent: 0, weekDelta: 0, pace: "red", inStretchZone: false, format: "count" },
    ],
  },
  {
    name: "California",
    slug: "california",
    goals: [
      { label: "Sales Closed", current: 402000, baseTarget: 700000, stretchTarget: 750000, percent: 57, weekDelta: 156000, pace: "green", inStretchZone: false, format: "currency" },
      { label: "Surveys Completed", current: 80000, baseTarget: 700000, stretchTarget: 750000, percent: 11, weekDelta: 50000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Design Approvals", current: 171000, baseTarget: 700000, stretchTarget: 750000, percent: 24, weekDelta: 63000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "Permits Issued", current: 168000, baseTarget: 700000, stretchTarget: 750000, percent: 24, weekDelta: 62000, pace: "yellow", inStretchZone: false, format: "currency" },
      { label: "Construction Completions", current: 43000, baseTarget: 700000, stretchTarget: 750000, percent: 6, weekDelta: 42000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "Inspections Passed", current: 268000, baseTarget: 700000, stretchTarget: 750000, percent: 38, weekDelta: 105000, pace: "green", inStretchZone: false, format: "currency" },
      { label: "PTO Granted", current: 76000, baseTarget: 700000, stretchTarget: 750000, percent: 11, weekDelta: 33000, pace: "red", inStretchZone: false, format: "currency" },
      { label: "5-Star Reviews", current: 0, baseTarget: 15, stretchTarget: 15, percent: 0, weekDelta: 0, pace: "red", inStretchZone: false, format: "count" },
    ],
  },
];

async function main() {
  console.log(`Sending 5 test goals digest emails to ${RECIPIENT}...\n`);

  // ---- 4 per-office emails ----
  for (const office of OFFICES) {
    const props: GoalsWeeklyDigestProps = {
      weekLabel: "Week of May 11, 2026",
      dayOfMonth: 11,
      daysInMonth: 31,
      monthName: "May",
      year: 2026,
      officeName: office.name,
      officeGoals: office.goals,
      companyGoals: MOCK_COMPANY,
      dashboardUrl: `https://pbtechops.com/dashboards/office-performance/${office.slug}`,
    };

    const html = await render(GoalsWeeklyDigest(props));
    const text = await render(GoalsWeeklyDigest(props), { plainText: true });

    console.log(`  Sending ${office.name}...`);
    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject: `[TEST] ${office.name} Goals — Week of May 11, 2026`,
      html,
      text,
      debugFallbackTitle: `${office.name} Goals Digest (Test)`,
      debugFallbackBody: text,
    });

    if (result.success) {
      console.log(`  ✓ ${office.name} sent`);
    } else {
      console.error(`  ✗ ${office.name} failed:`, result.error);
    }

    await sleep(1000);
  }

  // ---- Executive "All Locations" email ----
  {
    const allProps: GoalsWeeklyDigestProps = {
      weekLabel: "Week of May 11, 2026",
      dayOfMonth: 11,
      daysInMonth: 31,
      monthName: "May",
      year: 2026,
      officeName: "All Locations",
      officeGoals: MOCK_COMPANY,
      companyGoals: [],
      officeBreakdowns: OFFICES.map((o) => ({ officeName: o.name, goals: o.goals })),
      dashboardUrl: "https://pbtechops.com/dashboards/office-performance",
    };

    const html = await render(GoalsWeeklyDigest(allProps));
    const text = await render(GoalsWeeklyDigest(allProps), { plainText: true });

    console.log(`  Sending All Locations...`);
    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject: `[TEST] All Locations Goals — Week of May 11, 2026`,
      html,
      text,
      debugFallbackTitle: `All Locations Goals Digest (Test)`,
      debugFallbackBody: text,
    });

    if (result.success) {
      console.log(`  ✓ All Locations sent`);
    } else {
      console.error(`  ✗ All Locations failed:`, result.error);
    }
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
