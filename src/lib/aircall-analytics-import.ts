/**
 * Aircall Analytics+ CSV import.
 *
 * Source: User Activity+ → "ringing_attempts_per_user.csv" inside the dashboard
 * export ZIP. Columns: User ID, User, Total, Picked Up, Not Picked Up.
 *
 * One CSV represents a single (periodStart, periodEnd) window. The caller
 * supplies the period bounds — the CSV itself doesn't carry them.
 */

import { prisma as defaultPrisma } from "@/lib/db";
import type { PrismaClient } from "@/generated/prisma/client";

export interface ImportResult {
  rowsParsed: number;
  rowsImported: number;
  errors: Array<{ row: number; message: string }>;
  periodStart: string;
  periodEnd: string;
}

const REQUIRED_HEADERS = ["User ID", "User", "Total", "Picked Up", "Not Picked Up"];

/**
 * Minimal CSV parser tuned for Aircall's export format. Aircall always
 * double-quotes every field (verified across all 9 CSVs in their export).
 * We rely on that — no embedded newlines, no escape sequences. If they ever
 * change format, switch to a real CSV library.
 */
export function parseAircallCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = values[i] ?? "";
    return row;
  });
}

export async function importRingingAttemptsCsv(opts: {
  csvText: string;
  periodStart: Date;
  periodEnd: Date;
  importedBy?: string | null;
  filename?: string;
  prisma?: PrismaClient;
}): Promise<ImportResult> {
  const { csvText, periodStart, periodEnd, importedBy, filename } = opts;
  const prisma = opts.prisma ?? defaultPrisma;
  if (periodEnd <= periodStart) {
    throw new Error("periodEnd must be after periodStart");
  }
  const rows = parseAircallCsv(csvText);
  if (rows.length === 0) throw new Error("CSV is empty");
  const firstHeaders = Object.keys(rows[0]);
  for (const h of REQUIRED_HEADERS) {
    if (!firstHeaders.includes(h)) {
      throw new Error(`CSV is missing required column "${h}". Got: ${firstHeaders.join(", ")}`);
    }
  }

  const errors: ImportResult["errors"] = [];
  let imported = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const userAircallId = r["User ID"]?.trim();
    if (!userAircallId) {
      errors.push({ row: i + 2, message: "missing User ID" });
      continue;
    }
    const total = Number(r["Total"]);
    const picked = Number(r["Picked Up"]);
    const notPicked = Number(r["Not Picked Up"]);
    if (!Number.isFinite(total) || !Number.isFinite(picked) || !Number.isFinite(notPicked)) {
      errors.push({ row: i + 2, message: "non-numeric Total/Picked Up/Not Picked Up" });
      continue;
    }
    try {
      await prisma.aircallAnalyticsSummary.upsert({
        where: {
          source_userAircallId_periodStart_periodEnd: {
            source: "analytics_plus_csv",
            userAircallId,
            periodStart,
            periodEnd,
          },
        },
        create: {
          source: "analytics_plus_csv",
          provider: "aircall",
          userAircallId,
          userName: r["User"]?.trim() || null,
          periodStart,
          periodEnd,
          ringTotal: total,
          ringPickedUp: picked,
          ringNotPickedUp: notPicked,
          importedBy: importedBy ?? null,
          metadata: { filename: filename ?? null, raw: r } as object,
        },
        update: {
          userName: r["User"]?.trim() || null,
          ringTotal: total,
          ringPickedUp: picked,
          ringNotPickedUp: notPicked,
          importedAt: new Date(),
          importedBy: importedBy ?? null,
          metadata: { filename: filename ?? null, raw: r } as object,
        },
      });
      imported += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      errors.push({ row: i + 2, message });
    }
  }

  return {
    rowsParsed: rows.length,
    rowsImported: imported,
    errors,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}
