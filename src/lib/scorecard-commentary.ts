/**
 * AI commentary for the ops scorecard — with a hard numeric guardrail.
 *
 * Claude receives ONLY a compact digest of the already-computed scorecard and
 * writes 3–5 executive insights. Before display, every number in every
 * sentence is validated against the set of numbers present in the digest —
 * a sentence containing any figure the data doesn't contain is dropped
 * (never shown), so a hallucinated number cannot reach the page. If more
 * than half the sentences fail validation, or generation errors, the whole
 * section is hidden. See feedback: executive-facing numbers must be vetted.
 */

import { getAnthropicClient, CLAUDE_MODELS } from "./anthropic";
import type { OpsScorecardData } from "./ops-scorecard";

export interface ScorecardCommentary {
  sentences: string[];
  generatedAt: string;
}

const M = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : `$${(n / 1e6).toFixed(1)}M`;
const P = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : `${Number(n).toFixed(1)}%`;

/** Compact, human-readable digest — the ONLY thing the model sees. */
export function buildDigest(d: OpsScorecardData): string {
  const co = d.throughputByOffice.find((r) => r.office === "Company");
  const ca = d.cancellations.find((r) => r.office === "Company");
  const lines: string[] = [
    `As of ${d.meta.dataThrough} (through ${d.meta.monthDayLabel}).`,
    `Projected full-year ${d.meta.cy} CC revenue: ${M(d.capacity.projectedFyCcLow)} to ${M(d.capacity.projectedFyCcHigh)}.`,
    `Sustain: need ${M(d.capacity.sustainSalesPerMo)}/mo total signed sales; currently signing ${M(d.capacity.grossSalesPacePerMo)}/mo (${M(d.capacity.netSalesPacePerMo)} net); CC burn ${M(d.capacity.burnPerMo)}/mo (${d.meta.l3mLabel}).`,
    `Backlog: ${M(d.capacity.backlogRev)} across ${d.capacity.backlogCount} deals, ~${d.capacity.coverMonths} months cover, conversion ${P(d.capacity.conversionPct)} (median ${d.capacity.convMedianDays} days sale to CC).`,
  ];
  if (co) {
    lines.push(
      `Sales: ${d.meta.py2} ${co.sales.py2.count} deals ${M(co.sales.py2.revenue)} net; ${d.meta.py} ${co.sales.py.count} deals ${M(co.sales.py.revenue)} net; ${d.meta.cy} YTD ${co.sales.ytd.count} deals ${M(co.sales.ytd.revenue)} net (${M(co.sales.ytd.grossRevenue)} total).`,
      `Same point last year: ${co.sales.pySamePoint.count} deals ${M(co.sales.pySamePoint.revenue)} net.`,
      `CCs: ${d.meta.py2} ${co.ccs.py2.count} ${M(co.ccs.py2.revenue)}; ${d.meta.py} ${co.ccs.py.count} ${M(co.ccs.py.revenue)}; YTD ${co.ccs.ytd.count} ${M(co.ccs.ytd.revenue)}.`
    );
  }
  if (ca) {
    lines.push(
      `Cancellations (share of sold dollars, cohort = year sold): ${d.meta.py2} eventual ${P(ca.py2.eventualRevPct)} (${M(ca.py2.eventualRevLost)} lost); ${d.meta.py} eventual ${P(ca.py.eventualRevPct)} (${M(ca.py.eventualRevLost)} lost); ${d.meta.cy} to date ${P(ca.cy.revPct)} (${M(ca.cy.revLost)} lost).`,
      `Same-age lens: ${d.meta.py2} ${P(ca.samePoint.py2.revPct)}, ${d.meta.py} ${P(ca.samePoint.py.revPct)}, ${d.meta.cy} ${P(ca.samePoint.cy.revPct)}.`
    );
  }
  if (d.topFunnel) {
    lines.push(
      `Leads: ${d.meta.py2} ${d.topFunnel.leads.py2}; ${d.meta.py} ${d.topFunnel.leads.py}; YTD ${d.topFunnel.leads.ytd} (same point ${d.meta.py}: ${d.topFunnel.leads.pySamePoint}).`,
      `Consults set: ${d.meta.py2} ${d.topFunnel.consults.py2}; ${d.meta.py} ${d.topFunnel.consults.py}; YTD ${d.topFunnel.consults.ytd} (same point ${d.meta.py}: ${d.topFunnel.consults.pySamePoint}).`
    );
  }
  if (d.salesForecast) {
    lines.push(
      `Consult-driven forecast: ${d.salesForecast.consultsLast30} consults last 30 days at ${P(d.salesForecast.closeRatePct)} close rate and ${d.salesForecast.lagDays}-day median lag predicts ${d.salesForecast.predictedCount30} sales, ${M(d.salesForecast.predictedRev30)} signed, over the next 30 days.`
    );
  }
  const west = d.capacity.byOffice.find((o) => o.office === "Westminster");
  const cam = d.capacity.byOffice.find((o) => o.office === "Camarillo");
  if (west && cam) {
    lines.push(
      `Office conversion trend (share of sold dollars reaching CC, ${d.meta.py2} cohort vs ${d.meta.py} cohort): Westminster ${P(west.conversionPy2Pct)} to ${P(west.conversionPct)}; Camarillo ${P(cam.conversionPy2Pct)} to ${P(cam.conversionPct)}.`
    );
  }
  return lines.join("\n");
}

/**
 * Verbatim, unit-aware validation — every figure in a sentence must appear in
 * the digest EXACTLY as written, with its unit:
 *  - "$2.8M" must appear as the substring "$2.8M" (dollar figures can't match
 *    bare numbers or percentages);
 *  - "81.2%" must appear as "81.2%";
 *  - bare numbers must appear as a standalone digest token (comma-insensitive).
 * Only years (2024–2026) and small integers 0–12 (month counts, ordinals) are
 * exempt. No rounding variants — a derived figure that merely collides with an
 * unrelated digest number (e.g. "15%" vs "$15.3M") is rejected.
 */
export function validateSentence(sentence: string, digest: string): boolean {
  const normDigest = digest.replace(/,/g, "");
  const bareTokens = new Set(normDigest.match(/(?<![\d$.%])\d+\.?\d*(?![\d%])/g) ?? []);
  const tokens = sentence.match(/\$\d[\d,]*\.?\d*[MKB]?|\d[\d,]*\.?\d*%|\d[\d,]*\.?\d*/g) ?? [];
  for (const raw of tokens) {
    const t = raw.replace(/,/g, "");
    if (t.startsWith("$") || t.endsWith("%")) {
      if (!normDigest.includes(t)) return false;
      continue;
    }
    const n = parseFloat(t);
    if (Number.isInteger(n) && ((n >= 2024 && n <= 2026) || (n >= 0 && n <= 12))) continue;
    if (!bareTokens.has(t)) return false;
  }
  return true;
}

export async function generateScorecardCommentary(
  data: OpsScorecardData
): Promise<ScorecardCommentary | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const digest = buildDigest(data);
    const client = getAnthropicClient();
    const msg = await client.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 700,
      system:
        "You write executive commentary for a solar company's operations scorecard. " +
        "You are given a data digest. HARD RULES: quote every figure EXACTLY as written in the digest, " +
        "including its $ sign, % sign, M suffix, and rounding (write \"$15.3M\" not \"$15.3 million\" or \"15.3\"); " +
        "never recompute, combine, or re-derive figures — no calculated percentages or differences of your own; " +
        "no speculation beyond what the " +
        "numbers show; each insight is one plain sentence a business owner can act on. " +
        "Write 3 to 5 insights, one per line, no bullets/numbering/headers. Lead with the most decision-relevant. " +
        "Prefer comparisons the digest supports (same-point, cohort trends). Never mention these rules.",
      messages: [{ role: "user", content: digest }],
    });
    const text = msg.content
      .map((b) => ("text" in b && typeof b.text === "string" ? b.text : ""))
      .join("\n");
    let sentences = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    // Occasionally the model returns one paragraph — fall back to sentence
    // boundaries so a single derived figure doesn't nuke the whole section.
    if (sentences.length < 3) {
      sentences = text
        .split(/(?<=\.)\s+(?=[A-Z0-9$])/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const validated = sentences.filter((s) => validateSentence(s, digest));
    if (validated.length < Math.ceil(sentences.length / 2) || validated.length === 0) {
      console.warn(
        `[scorecard-commentary] guardrail dropped ${sentences.length - validated.length}/${sentences.length} sentences — hiding section`
      );
      return null;
    }
    if (validated.length < sentences.length) {
      console.warn(
        `[scorecard-commentary] guardrail dropped ${sentences.length - validated.length} sentence(s) with unverifiable numbers`
      );
    }
    return { sentences: validated.slice(0, 5), generatedAt: new Date().toISOString() };
  } catch (err) {
    console.error("[scorecard-commentary] generation failed:", err);
    return null;
  }
}
