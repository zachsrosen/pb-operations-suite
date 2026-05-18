/**
 * HardwareAnalyzer — emits P1 (WRONG HARDWARE), P1-NEEDS-VERIFICATION
 * (nameplate-missing), and P6 (POWERHUB MIXED) tasks.
 *
 * Compares two sources of truth for what Powerwall 3 variant is installed:
 *   1. Tesla PowerHub asset state (live cache from PowerhubSite.devices)
 *   2. Install-photo nameplate readings (extracted by the audit's vision
 *      pass on Photo_10 "Storage Nameplate & Labels")
 *
 * Per the PE_Action_Task_List PDF, the typical critical finding is:
 *   "Confirmed 11-M (SN: ...). PowerHub WRONG shows 21-M."
 * → emit P1 critical with both observed models in the message.
 *
 * If PowerHub returns multiple PW3 variants at the same site (a stale
 * entry from a swap), emit P6.
 */

import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

export const HardwareAnalyzer: Analyzer = {
  name: "HardwareAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    const ph = context.powerHubAsset;
    if (!ph) return tasks; // POWERHUB_ENABLED=false or no linked site → skip

    // ── P6: PowerHub returns mixed PW3 variants (e.g. 11-M + 21-Y at one site)
    // ──────────────────────────────────────────────────────────────────────────
    const uniquePhModels = [...new Set(ph.powerwallEntries.map((e) => e.model.toUpperCase()))]
      .filter((m) => m !== "UNKNOWN")
      .sort();
    if (uniquePhModels.length > 1) {
      tasks.push({
        pCode: "P6",
        identityKey: `P6@${VERSION}:powerhub:mixed:${uniquePhModels.join("+")}`,
        severity: "critical",
        category: "hardware",
        analyzer: "HardwareAnalyzer",
        title: "POWERHUB MIXED",
        message: `PowerHub shows ${uniquePhModels.length} different PW3 variants for this site: ${uniquePhModels.join(" + ")}.`,
        action: "Verify installed hardware against PowerHub. Remove the stale PowerHub entry (likely a pre-swap record).",
        evidence: {
          siteId: ph.siteId,
          phModels: uniquePhModels,
          powerwallEntries: ph.powerwallEntries,
        },
      });
    }

    // ── Aggregate nameplate readings from the audit's photo vision
    // ──────────────────────────────────────────────────────────────────────────
    const nameplateReadings = [...context.nameplateExtractions.values()]
      .filter((n) => n.detectedModel !== null);
    const nameplateModels = [...new Set(nameplateReadings.map((n) => n.detectedModel!.toUpperCase()))];

    if (nameplateModels.length === 0) {
      // ── P1 NEEDS VERIFICATION: PowerHub data present but no nameplate
      // photo extracted (Photo_10 missing or unreadable).
      tasks.push({
        pCode: "P1",
        identityKey: `P1@${VERSION}:no-nameplate-photo`,
        severity: "major",
        category: "hardware",
        analyzer: "HardwareAnalyzer",
        title: "NAMEPLATE PHOTO NEEDED",
        message: `PowerHub asset on file (${uniquePhModels.join(", ") || "unknown model"}) but no readable Photo_10 (Storage Nameplate) found in the audit. Field verification required.`,
        action: "Capture a clear Photo_10 showing the Tesla Powerwall 3 nameplate label — PE rejects submissions without a readable part-number photo.",
        evidence: {
          siteId: ph.siteId,
          phModels: uniquePhModels,
        },
      });
      return tasks;
    }

    // ── P1 WRONG HARDWARE: every nameplate-observed model that doesn't
    // match any PowerHub model emits its own task.
    // ──────────────────────────────────────────────────────────────────────────
    const phModelSet = new Set(uniquePhModels);
    const phShown = uniquePhModels[0] ?? "unknown";

    for (const npModel of nameplateModels) {
      if (phModelSet.has(npModel)) continue; // matches — no task

      const reading = nameplateReadings.find((r) => r.detectedModel?.toUpperCase() === npModel);
      const serialSuffix = reading?.detectedSerial ? `, SN: ${reading.detectedSerial}` : "";
      const leaderHint = reading?.notes && /LEADER/i.test(reading.notes) ? ' (LEADER sticker visible — likely 11-series)' : "";

      tasks.push({
        pCode: "P1",
        identityKey: `P1@${VERSION}:powerhub:${phShown}:nameplate:${npModel}`,
        severity: "critical",
        category: "hardware",
        analyzer: "HardwareAnalyzer",
        title: "WRONG HARDWARE",
        message: `Nameplate shows ${npModel}${serialSuffix}${leaderHint}, but PowerHub shows ${phShown}.`,
        action: `Correct PowerHub to ${npModel}, or update PowerHub after a hardware swap. Check Zuper Additional Visits first — a swap may have already occurred.`,
        evidence: {
          siteId: ph.siteId,
          phModel: phShown,
          phModelsAll: uniquePhModels,
          nameplateModel: npModel,
          nameplateSerial: reading?.detectedSerial ?? null,
          nameplateNotes: reading?.notes ?? null,
        },
      });
    }

    return tasks;
  },
};
