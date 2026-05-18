/**
 * Monitoring folder extractor.
 *
 * Scans the M1 folder for PowerHub monitoring screenshots and detects whether
 * a "corrected" version is present. No LLM — pure file-pattern + metadata.
 *
 * Used by MonitoringAnalyzer (MONITORING + ENPHASE rules).
 */

import { listDriveFilesRecursive } from "@/lib/drive-plansets";
import type { MonitoringFolderScan } from "@/lib/pe-crossref/types";

const POWERHUB_FILE_RE = /powerhub/i;
const CORRECTED_FILE_RE = /(corrected|fixed|updated)/i;
const MONITORING_FILE_RE = /(monitoring|enphase|enlighten|solaredge)/i;

export async function scanM1MonitoringFolder(m1FolderId: string | null): Promise<MonitoringFolderScan | null> {
  if (!m1FolderId) return null;
  const files = await listDriveFilesRecursive(m1FolderId, 3, 100);

  const powerHubFiles = files.filter((f) => POWERHUB_FILE_RE.test(f.name));
  const correctedFiles = powerHubFiles.filter((f) => CORRECTED_FILE_RE.test(f.name));
  const hasMonitoringScreenshot = files.some(
    (f) => MONITORING_FILE_RE.test(f.name) || POWERHUB_FILE_RE.test(f.name),
  );

  // Most-recently-modified corrected file, if any.
  const correctedScreenshotFile =
    correctedFiles.length > 0
      ? correctedFiles.reduce((latest, f) =>
          new Date(f.modifiedTime) > new Date(latest.modifiedTime) ? f : latest,
        )
      : null;

  return {
    m1FolderId,
    hasOriginalScreenshot: hasMonitoringScreenshot,
    correctedScreenshotFile: correctedScreenshotFile
      ? {
          id: correctedScreenshotFile.id,
          name: correctedScreenshotFile.name,
          modifiedTime: correctedScreenshotFile.modifiedTime,
        }
      : null,
  };
}
