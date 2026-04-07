/**
 * Solar Designer Parse API
 *
 * POST /api/solar-designer/parse
 *   Accepts an array of Vercel Blob URLs (uploaded via the client-side
 *   @vercel/blob/client upload flow), fetches each file, runs the
 *   appropriate parser (JSON / DXF / CSV), and returns structured panel +
 *   shade data.  Blob objects are deleted after parsing so storage is not
 *   consumed long-term.
 *
 *   Body: { files: [{ url: string; name: string }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { parseJSON, parseDXF, parseShadeCSV } from '@/lib/solar/v12-engine';
import type {
  PanelGeometry,
  ShadeTimeseries,
  ShadeFidelity,
  ShadeSource,
} from '@/lib/solar/v12-engine';
import type { RadiancePoint } from '@/lib/solar/v12-engine/layout-parser';

interface ParseRequestFile {
  url: string;
  name: string;
}

interface ParseResult {
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  shadeFidelity: ShadeFidelity;
  shadeSource: ShadeSource;
  radiancePoints: RadiancePoint[];
  fileCount: number;
  errors: string[];
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ParseResult | { error: string }>> {
  let files: ParseRequestFile[];
  try {
    const body = (await req.json()) as { files?: ParseRequestFile[] };
    files = body.files ?? [];
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  const allPanels: PanelGeometry[] = [];
  const allShadeData: ShadeTimeseries = {};
  const allErrors: string[] = [];
  const allRadiancePoints: RadiancePoint[] = [];
  let shadeFidelity: ShadeFidelity = 'full';
  let shadeSource: ShadeSource = 'manual';

  // Collect blob URLs for cleanup after parsing
  const blobUrls: string[] = [];

  try {
    for (const file of files) {
      blobUrls.push(file.url);

      // Fetch file content from Vercel Blob
      let text: string;
      try {
        const res = await fetch(file.url);
        if (!res.ok) {
          allErrors.push(`${file.name}: Failed to fetch from blob (${res.status})`);
          continue;
        }
        text = await res.text();
      } catch (fetchErr) {
        const msg =
          fetchErr instanceof Error ? fetchErr.message : 'Fetch failed';
        allErrors.push(`${file.name}: ${msg}`);
        continue;
      }

      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'json') {
        const result = parseJSON(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map((e) => `${file.name}: ${e}`));
        }
        allPanels.push(...result.panels);
      } else if (ext === 'dxf') {
        const result = parseDXF(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map((e) => `${file.name}: ${e}`));
        }
        allPanels.push(...result.panels);
        allRadiancePoints.push(...result.radiancePoints);
      } else if (ext === 'csv') {
        const result = parseShadeCSV(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map((e) => `${file.name}: ${e}`));
        }
        Object.assign(allShadeData, result.data);
        shadeFidelity = result.fidelity;
        shadeSource = result.source;
      } else {
        allErrors.push(
          `${file.name}: Unsupported file type .${ext}. Expected .dxf, .json, or .csv`,
        );
      }
    }

    return NextResponse.json({
      panels: allPanels,
      shadeData: allShadeData,
      shadeFidelity,
      shadeSource,
      radiancePoints: allRadiancePoints,
      fileCount: files.length,
      errors: allErrors,
    });
  } finally {
    // Best-effort blob cleanup — don't let cleanup failure affect the response
    if (blobUrls.length > 0) {
      del(blobUrls).catch((err) => {
        console.warn('[solar-designer/parse] Blob cleanup failed:', err);
      });
    }
  }
}
