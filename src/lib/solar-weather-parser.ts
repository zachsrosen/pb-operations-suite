/**
 * NREL PSM3 TMY CSV Parser
 *
 * Extracts GHI (W/m²) and Temperature (°C) from NREL NSRDB CSV responses.
 * Handles variable metadata rows by dynamically detecting the header row
 * containing "Year,Month,Day,Hour,Minute".
 */

/** Header columns that identify the time-series header row */
const HEADER_MARKERS = ["year", "month", "day", "hour", "minute"];

export type ParseSuccess = {
  ok: true;
  data: { ghi: number[]; temperature: number[] };
};

export type ParseFailure = {
  ok: false;
  error: string;
  totalLines?: number;
  headerRowIndex?: number;
};

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Parse NREL PSM3 TMY CSV response.
 *
 * NREL CSV format has variable metadata rows before the time-series header.
 * Instead of hardcoding row indices, we scan for the row containing
 * "Year,Month,Day,Hour,Minute" and use that as the header.
 * Data rows follow immediately after the header row.
 */
export function parseNrelCsv(csv: string): ParseResult {
  try {
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length < 3) {
      return {
        ok: false,
        error: `CSV too short: ${lines.length} lines`,
        totalLines: lines.length,
      };
    }

    // ── Find header row dynamically ───────────────────────
    // Scan for the row whose lowercase columns include all of:
    // year, month, day, hour, minute
    let headerRowIndex = -1;
    let headers: string[] = [];

    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const cols = lines[i].split(",").map((h) => h.trim().toLowerCase());
      const hasAll = HEADER_MARKERS.every((marker) =>
        cols.some((c) => c === marker)
      );
      if (hasAll) {
        headerRowIndex = i;
        headers = cols;
        break;
      }
    }

    if (headerRowIndex === -1) {
      return {
        ok: false,
        error: `Header row not found. Scanned first ${Math.min(lines.length, 20)} rows for [${HEADER_MARKERS.join(",")}]`,
        totalLines: lines.length,
      };
    }

    // ── Find column indices ───────────────────────────────
    // NREL uses various header names for GHI and temperature
    const ghiIdx = headers.findIndex(
      (h) => h === "ghi" || h === "ghi (w/m2)" || h === "ghi (w/m^2)"
    );
    const tempIdx = headers.findIndex(
      (h) =>
        h === "temperature" ||
        h === "air temperature" ||
        h === "temperature (c)" ||
        h === "air temperature (c)"
    );

    if (ghiIdx === -1 || tempIdx === -1) {
      return {
        ok: false,
        error: `Column mismatch: GHI idx=${ghiIdx}, temp idx=${tempIdx}. Headers: [${headers.join(", ")}]`,
        totalLines: lines.length,
        headerRowIndex,
      };
    }

    // ── Extract data rows ─────────────────────────────────
    // Data starts immediately after the header row
    const dataStartIndex = headerRowIndex + 1;
    const ghi: number[] = [];
    const temperature: number[] = [];

    for (let i = dataStartIndex; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length <= Math.max(ghiIdx, tempIdx)) continue;

      const g = parseFloat(cols[ghiIdx]);
      const t = parseFloat(cols[tempIdx]);

      if (isNaN(g) || isNaN(t)) {
        // Skip invalid rows but don't fail — some CSVs have trailing junk
        continue;
      }

      ghi.push(g);
      temperature.push(t);
    }

    return { ok: true, data: { ghi, temperature } };
  } catch (err) {
    return {
      ok: false,
      error: `Parse exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
