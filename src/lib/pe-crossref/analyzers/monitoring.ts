/**
 * MonitoringAnalyzer — emits MONITORING + ENPHASE tasks.
 *
 * No LLM. Pure rules over the monitoring-folder scan + planset extraction.
 */

import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

export const MonitoringAnalyzer: Analyzer = {
  name: "MonitoringAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];

    // MONITORING — corrected PowerHub screenshot ready for re-upload
    if (context.monitoringFolder?.correctedScreenshotFile) {
      const file = context.monitoringFolder.correctedScreenshotFile;
      tasks.push({
        pCode: "MONITORING",
        identityKey: `MONITORING@${VERSION}:m1-folder:powerhub-corrected`,
        severity: "monitoring",
        category: "monitoring",
        analyzer: "MonitoringAnalyzer",
        title: "PowerHub screenshot ready for re-upload",
        message: `Corrected PowerHub screenshot in M1 folder: ${file.name} (modified ${file.modifiedTime.slice(0, 10)}).`,
        action: "Re-upload the corrected screenshot to the PE portal.",
        evidence: { fileId: file.id, fileName: file.name, modifiedTime: file.modifiedTime },
      });
    }

    // ENPHASE — Enphase inverter on deal but no monitoring screenshot in M1
    if (context.planset && context.monitoringFolder && !context.monitoringFolder.hasOriginalScreenshot) {
      const enphasePage = context.planset.specsByPage.find((p) =>
        (p.inverterModel ?? "").toLowerCase().includes("enphase"),
      );
      if (enphasePage) {
        tasks.push({
          pCode: "ENPHASE",
          identityKey: `ENPHASE@${VERSION}:account-access`,
          severity: "monitoring",
          category: "monitoring",
          analyzer: "MonitoringAnalyzer",
          title: "Enphase monitoring screenshot needed",
          message: "Deal has Enphase inverter but no monitoring screenshot in M1 folder.",
          action: "Capture Enphase Enlighten monitoring screenshot and upload to M1 folder.",
          evidence: { detectedInverter: enphasePage.inverterModel, page: enphasePage.page },
        });
      }
    }

    return tasks;
  },
};
