/**
 * PBO-003a — Fixture-based tests for NREL TMY CSV parser
 *
 * Tests:
 *  1. Valid NSRDB CSV with 1 metadata row → exactly 8,760 rows
 *  2. Valid NSRDB CSV with 3 metadata rows → exactly 8,760 rows
 *  3. Malformed header (missing GHI column) → error path
 *  4. Missing header row entirely → error path
 *  5. CSV too short → error path
 *  6. Partial invalid data rows skipped gracefully
 */

import { parseNrelCsv } from "@/lib/solar-weather-parser";

// ── Helpers ─────────────────────────────────────────────────

/** Generate N hourly data rows with plausible GHI and temperature values */
function generateDataRows(
  n: number,
  ghiIdx: number,
  tempIdx: number,
  totalCols: number
): string[] {
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const hour = i % 24;
    // Simulate diurnal GHI pattern: 0 at night, peak ~800 at noon
    const ghi =
      hour >= 6 && hour <= 18
        ? Math.round(Math.sin(((hour - 6) / 12) * Math.PI) * 800)
        : 0;
    const temp = 15 + 10 * Math.sin(((hour - 6) / 24) * Math.PI * 2);

    const cols = new Array(totalCols).fill("0");
    cols[0] = "2021"; // Year
    cols[1] = String(Math.floor(i / 24) + 1); // Day approx
    cols[2] = "1"; // Month
    cols[3] = String(hour); // Hour
    cols[4] = "0"; // Minute
    cols[ghiIdx] = String(ghi);
    cols[tempIdx] = temp.toFixed(1);
    rows.push(cols.join(","));
  }
  return rows;
}

/** Standard NSRDB header row */
const STANDARD_HEADER =
  "Year,Month,Day,Hour,Minute,GHI,DNI,DHI,Temperature,Pressure,Wind Speed";

// ── Tests ───────────────────────────────────────────────────

describe("parseNrelCsv", () => {
  it("parses valid CSV with 1 metadata row → 8760 rows", () => {
    const metadataRow = "Source,Location ID,Latitude,Longitude,Timezone";
    const dataRows = generateDataRows(8760, 5, 8, 11);
    const csv = [metadataRow, STANDARD_HEADER, ...dataRows].join("\n");

    const result = parseNrelCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ghi).toHaveLength(8760);
    expect(result.data.temperature).toHaveLength(8760);
    // Verify first value is plausible (midnight = 0 GHI)
    expect(result.data.ghi[0]).toBe(0);
    // Temperature at hour 0 from our sinusoidal fixture
    expect(typeof result.data.temperature[0]).toBe("number");
    expect(result.data.temperature[0]).not.toBeNaN();
  });

  it("parses valid CSV with 3 metadata rows before header → 8760 rows", () => {
    // This is the exact failure mode from PBO-003a P0:
    // NSRDB sometimes includes multiple metadata rows
    const meta1 = "Source,Location ID,Latitude,Longitude,Timezone";
    const meta2 = "PSM3,123456,39.74,-104.98,-7";
    const meta3 = "Version,3.2.2,,,";
    const dataRows = generateDataRows(8760, 5, 8, 11);
    const csv = [meta1, meta2, meta3, STANDARD_HEADER, ...dataRows].join("\n");

    const result = parseNrelCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ghi).toHaveLength(8760);
    expect(result.data.temperature).toHaveLength(8760);
  });

  it("parses CSV with alternative header names (air temperature)", () => {
    const altHeader =
      "Year,Month,Day,Hour,Minute,GHI (W/m2),DNI,DHI,Air Temperature,Pressure";
    const metadataRow = "Source,Location ID,Lat,Lng,TZ";
    const dataRows = generateDataRows(8760, 5, 8, 10);
    const csv = [metadataRow, altHeader, ...dataRows].join("\n");

    const result = parseNrelCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ghi).toHaveLength(8760);
    expect(result.data.temperature).toHaveLength(8760);
  });

  it("returns error when GHI column is missing from header", () => {
    const badHeader =
      "Year,Month,Day,Hour,Minute,DNI,DHI,Temperature,Pressure";
    const metadataRow = "Source,Location";
    const csv = [metadataRow, badHeader, "2021,1,1,0,0,100,50,15,1013"].join(
      "\n"
    );

    const result = parseNrelCsv(csv);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("GHI idx=-1");
  });

  it("returns error when no header row is found", () => {
    // All rows are metadata — no Year,Month,Day,Hour,Minute row
    const lines = [
      "Source,Location ID,Latitude,Longitude",
      "PSM3,123456,39.74,-104.98",
      "Notes,This is just metadata",
      "More,metadata,here,too",
    ].join("\n");

    const result = parseNrelCsv(lines);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Header row not found");
  });

  it("returns error when CSV is too short", () => {
    const result = parseNrelCsv("Source,Location\n");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("too short");
  });

  it("skips invalid data rows without failing", () => {
    const metadataRow = "Source,Location";
    const dataRows = generateDataRows(8758, 5, 8, 11);
    // Add 2 invalid rows at the end
    dataRows.push("bad,data,row");
    dataRows.push("2021,1,1,0,0,not_a_number,100,50,also_bad,1013,5");
    const csv = [metadataRow, STANDARD_HEADER, ...dataRows].join("\n");

    const result = parseNrelCsv(csv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should have 8758 valid rows (2 invalid skipped)
    expect(result.data.ghi).toHaveLength(8758);
    expect(result.data.temperature).toHaveLength(8758);
  });

  it("handles empty string input", () => {
    const result = parseNrelCsv("");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("too short");
  });
});
