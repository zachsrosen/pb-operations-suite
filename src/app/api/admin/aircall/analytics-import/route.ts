/**
 * POST /api/admin/aircall/analytics-import
 *
 * Imports a `ringing_attempts_per_user.csv` (from Aircall Analytics+ export
 * ZIP) as a per-user period summary. Admin-gated.
 *
 * Body: multipart/form-data with `file` + `periodStart` + `periodEnd`,
 *   OR application/json with { csv: string, periodStart, periodEnd }.
 */

import { NextRequest, NextResponse } from "next/server";

import { importRingingAttemptsCsv } from "@/lib/aircall-analytics-import";
import { requireRole } from "@/lib/auth-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let csv: string | null = null;
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let filename: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "missing 'file'" }, { status: 400 });
    csv = await file.text();
    filename = file.name;
    const psRaw = String(form.get("periodStart") ?? "");
    const peRaw = String(form.get("periodEnd") ?? "");
    if (psRaw) periodStart = new Date(psRaw);
    if (peRaw) periodEnd = new Date(peRaw);
  } else {
    const body = (await req.json().catch(() => null)) as
      | { csv?: string; periodStart?: string; periodEnd?: string; filename?: string }
      | null;
    if (!body?.csv) return NextResponse.json({ error: "missing 'csv'" }, { status: 400 });
    csv = body.csv;
    filename = body.filename;
    if (body.periodStart) periodStart = new Date(body.periodStart);
    if (body.periodEnd) periodEnd = new Date(body.periodEnd);
  }

  if (!periodStart || !periodEnd || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ error: "periodStart and periodEnd are required ISO date strings" }, { status: 400 });
  }

  try {
    const result = await importRingingAttemptsCsv({
      csvText: csv,
      periodStart,
      periodEnd,
      importedBy: user.email,
      filename,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
