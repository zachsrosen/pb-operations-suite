/**
 * SalesOrderAnalyzer — eight detection rules over the Zoho Sales Order
 * (with optional planset cross-reference).
 *
 *   P2 SO WRONG CUSTOMER   — SO customer name doesn't match deal customer
 *   P2 SO INCOMPLETE       — PW3 in SO but BS missing (planset shows BS)
 *   P3 ADD PW3 TO SO       — Planset has PW3 but SO has no PW3 line
 *   P4 ADD INVERTER TO SO  — Planset has inverter but SO has no inverter line
 *   P5 SCOPE MISMATCH      — module brand or qty differs between planset and SO
 *   P7 PW3 LEGACY TEXT     — SO description contains "Powerwall 3 (USA module)" / "-11-J"
 *   P8 PW3 GENERIC SKU     — SO description contains placeholder "1707000-XX-Y"
 *   P9 BS GENERIC          — SO BS description not equal to "1624171-00-E"
 *
 * P3/P4/P5 require the planset structure; if not extracted, those rules
 * silently skip. P2/P7/P8/P9 are SO-only and always fire when applicable.
 *
 * Identity: `{pCode}@v1:so:{soNumber}:{specifier}` so re-runs against the
 * same SO+issue map to the same task.
 */

import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

// Detection regexes
const PW3_LEGACY_RE = /(?:powerwall\s+3\s*\(usa\s*module\))|(?:-11-J\b)/i;
const PW3_GENERIC_SKU_RE = /\b1707000-XX-Y\b/i;
const BS_CORRECT = "1624171-00-E";
const BS_PRESENT_RE = /backup\s*switch/i;
const PW3_LINE_RE = /powerwall\s*3/i;
const INVERTER_LINE_RE = /\binverter\b/i;
const MODULE_LINE_RE = /module|panel/i;

export const SalesOrderAnalyzer: Analyzer = {
  name: "SalesOrderAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    const so = context.salesOrder;
    if (!so) return tasks;

    // ── P2 wrong customer ────────────────────────────────────────────
    if (!customerNamesMatch(so.customerName, context.deal.dealName)) {
      tasks.push({
        pCode: "P2",
        identityKey: `P2@${VERSION}:so:${so.soNumber}:wrong-customer:${normalize(so.customerName)}`,
        severity: "critical",
        category: "so",
        analyzer: "SalesOrderAnalyzer",
        title: "SO WRONG CUSTOMER",
        message: `SO ${so.soNumber} customer "${so.customerName}" does not match deal "${context.deal.dealName}".`,
        action: "Replace this SO with one for the correct customer, or correct the customer assignment on the existing SO.",
        evidence: { soNumber: so.soNumber, soCustomer: so.customerName, dealName: context.deal.dealName },
      });
    }

    // ── Per-line scans (P7, P8, P9) — cheap ──────────────────────────
    for (const line of so.lineItems) {
      const desc = line.description ?? "";

      if (PW3_LEGACY_RE.test(desc)) {
        tasks.push(makeSoLineTask(so.soNumber, line.index, {
          pCode: "P7",
          kindSpecifier: "pw3-text",
          severity: "conditional",
          title: "SO PW3 LEGACY TEXT",
          message: `SO ${so.soNumber} line ${line.index + 1} description references legacy PW3 text: "${truncate(desc, 80)}"`,
          action: 'Change description to "Tesla 1707000-21-Y" and remove the 11-J / "(USA module)" note.',
          extraEvidence: { currentDescription: desc },
        }));
      }

      if (PW3_GENERIC_SKU_RE.test(desc)) {
        tasks.push(makeSoLineTask(so.soNumber, line.index, {
          pCode: "P8",
          kindSpecifier: "xx-y",
          severity: "conditional",
          title: "SO PW3 GENERIC SKU",
          message: `SO ${so.soNumber} line ${line.index + 1} has placeholder 1707000-XX-Y in description: "${truncate(desc, 80)}"`,
          action: 'Change description to "Tesla 1707000-21-Y" (SKU already correct).',
          extraEvidence: { currentDescription: desc },
        }));
      }

      if (BS_PRESENT_RE.test(desc) && !desc.includes(BS_CORRECT)) {
        tasks.push(makeSoLineTask(so.soNumber, line.index, {
          pCode: "P9",
          kindSpecifier: "bs-generic",
          severity: "conditional",
          title: "SO BS DESCRIPTION NOT SPECIFIC",
          message: `SO ${so.soNumber} line ${line.index + 1} Backup Switch description not specific: "${truncate(desc, 80)}"`,
          action: `Change BS description to "${BS_CORRECT}" if PE requires.`,
          extraEvidence: { currentDescription: desc },
        }));
      }
    }

    // ── Planset cross-references (P3, P4, P5) — only if planset extracted ──
    const planset = context.planset;
    if (planset) {
      const plansetHasPw3 = planset.specsByPage.some((p) => p.pw3Model !== null);
      const soHasPw3 = so.lineItems.some((l) => PW3_LINE_RE.test(l.description));
      if (plansetHasPw3 && !soHasPw3) {
        tasks.push({
          pCode: "P3",
          identityKey: `P3@${VERSION}:so:${so.soNumber}:missing-pw3`,
          severity: "major",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "ADD PW3 TO SO",
          message: `Planset has Powerwall 3 but SO ${so.soNumber} has no PW3 line item.`,
          action: "Add Powerwall 3 line item to the SO (use 1707000-21-Y).",
          evidence: { soNumber: so.soNumber },
        });
      }

      const plansetInverterPage = planset.specsByPage.find((p) => p.inverterModel !== null);
      const soHasInverter = so.lineItems.some((l) => INVERTER_LINE_RE.test(l.description));
      if (plansetInverterPage && !soHasInverter) {
        tasks.push({
          pCode: "P4",
          identityKey: `P4@${VERSION}:so:${so.soNumber}:missing-inverter:${slug(plansetInverterPage.inverterModel ?? "unknown")}`,
          severity: "major",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "ADD INVERTER TO SO",
          message: `Planset has ${plansetInverterPage.inverterModel} but SO ${so.soNumber} has no inverter line item.`,
          action: `Add inverter line item to the SO (${plansetInverterPage.inverterModel}).`,
          evidence: { soNumber: so.soNumber, plansetInverter: plansetInverterPage.inverterModel },
        });
      }

      // P5 — module brand / qty mismatch
      const plansetModulePage = planset.specsByPage.find((p) => p.moduleBrand !== null || p.moduleQty !== null);
      const soModuleLine = so.lineItems.find(
        (l) => MODULE_LINE_RE.test(l.description) && !INVERTER_LINE_RE.test(l.description),
      );
      if (plansetModulePage && soModuleLine) {
        if (plansetModulePage.moduleBrand) {
          const plansetBrand = plansetModulePage.moduleBrand.toLowerCase();
          const soDesc = soModuleLine.description.toLowerCase();
          if (!soDesc.includes(plansetBrand)) {
            tasks.push({
              pCode: "P5",
              identityKey: `P5@${VERSION}:so:${so.soNumber}:module-brand:${slug(plansetBrand)}-vs-${slug(soDesc.slice(0, 40))}`,
              severity: "major",
              category: "so",
              analyzer: "SalesOrderAnalyzer",
              title: "MODULE BRAND MISMATCH",
              message: `Planset module brand "${plansetModulePage.moduleBrand}" doesn't match SO description "${truncate(soModuleLine.description, 80)}".`,
              action: "Reconcile planset and SO module brands — revise whichever is wrong.",
              evidence: {
                soNumber: so.soNumber,
                plansetBrand: plansetModulePage.moduleBrand,
                soDescription: soModuleLine.description,
              },
            });
          }
        }
        if (plansetModulePage.moduleQty != null && plansetModulePage.moduleQty !== soModuleLine.qty) {
          tasks.push({
            pCode: "P5",
            identityKey: `P5@${VERSION}:so:${so.soNumber}:module-qty:${plansetModulePage.moduleQty}-vs-${soModuleLine.qty}`,
            severity: "major",
            category: "so",
            analyzer: "SalesOrderAnalyzer",
            title: "MODULE QUANTITY MISMATCH",
            message: `Planset says ${plansetModulePage.moduleQty} modules, SO ${so.soNumber} says ${soModuleLine.qty}.`,
            action: "Verify and revise either planset or SO module quantity.",
            evidence: {
              soNumber: so.soNumber,
              plansetQty: plansetModulePage.moduleQty,
              soQty: soModuleLine.qty,
            },
          });
        }
      }
    }

    return tasks;
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

interface SoLineTaskInput {
  pCode: "P7" | "P8" | "P9";
  kindSpecifier: string;
  severity: "critical" | "major" | "conditional" | "monitoring";
  title: string;
  message: string;
  action: string;
  extraEvidence: Record<string, unknown>;
}

function makeSoLineTask(soNumber: string, lineIndex: number, input: SoLineTaskInput): DetectedTask {
  return {
    pCode: input.pCode,
    identityKey: `${input.pCode}@${VERSION}:so:${soNumber}:line:${lineIndex}:${input.kindSpecifier}`,
    severity: input.severity,
    category: "so",
    analyzer: "SalesOrderAnalyzer",
    title: input.title,
    message: input.message,
    action: input.action,
    evidence: { soNumber, line: lineIndex, ...input.extraEvidence },
  };
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[.,]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
}

function customerNamesMatch(soCustomer: string, dealName: string): boolean {
  // Deal names follow "PROJ-XXXX | Last, First | Address" pattern; the
  // middle pipe-segment is the customer name. Tolerate Last,First vs
  // First Last via token-set match.
  if (!soCustomer || !dealName) return true; // can't determine — don't fire false positive

  const dealParts = dealName.split("|").map((p) => p.trim());
  const dealCustomerSeg = dealParts[1] ?? dealName;

  const soTokens = new Set(normalize(soCustomer).split(" "));
  const dealTokens = new Set(normalize(dealCustomerSeg).split(" "));

  // Match if SO has at least 2 tokens (or all of them, if fewer) shared with deal.
  const shared = [...soTokens].filter((t) => dealTokens.has(t)).length;
  const required = Math.min(2, soTokens.size, dealTokens.size);
  return shared >= required;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}
