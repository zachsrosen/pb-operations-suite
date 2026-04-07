import { NextRequest, NextResponse } from 'next/server';
import { parseJSON, parseDXF, parseShadeCSV } from '@/lib/solar/v12-engine';
import type { PanelGeometry, ShadeTimeseries, ShadeFidelity, ShadeSource } from '@/lib/solar/v12-engine';
import type { RadiancePoint } from '@/lib/solar/v12-engine/layout-parser';

interface UploadResult {
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  shadeFidelity: ShadeFidelity;
  shadeSource: ShadeSource;
  radiancePoints: RadiancePoint[];
  fileCount: number;
  errors: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse<UploadResult | { error: string }>> {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const allPanels: PanelGeometry[] = [];
    const allShadeData: ShadeTimeseries = {};
    const allErrors: string[] = [];
    const allRadiancePoints: RadiancePoint[] = [];
    // Track shade fidelity/source from parsed files (last CSV wins).
    // Today all sources return 'full'/'manual', but Stage 7 will add
    // EagleView and Google Solar adapters with different values.
    let shadeFidelity: ShadeFidelity = 'full';
    let shadeSource: ShadeSource = 'manual';

    for (const file of files) {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'json') {
        const result = parseJSON(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${file.name}: ${e}`));
        }
        allPanels.push(...result.panels);
      } else if (ext === 'dxf') {
        const result = parseDXF(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${file.name}: ${e}`));
        }
        allPanels.push(...result.panels);
        allRadiancePoints.push(...result.radiancePoints);
      } else if (ext === 'csv') {
        const result = parseShadeCSV(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${file.name}: ${e}`));
        }
        Object.assign(allShadeData, result.data);
        shadeFidelity = result.fidelity;
        shadeSource = result.source;
      } else {
        allErrors.push(`${file.name}: Unsupported file type .${ext}. Expected .dxf, .json, or .csv`);
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
