/**
 * BOM Email Enrichment — Fail-open enrichment for scheduling notifications
 *
 * Provides BOM snapshot data, Zoho SO info, and optional PDF attachment
 * for install scheduling emails. All operations are fail-open: errors
 * return a discriminated result so callers can distinguish "no snapshot"
 * (may trigger fallback pipeline) from "error" (should NOT trigger fallback).
 *
 * Also exports a lightweight `checkBomSnapshotExists()` for the async
 * fallback trigger path (no heavy parsing, just existence check).
 */

import { prisma } from "@/lib/db";
import { getZohoSalesOrderUrl } from "@/lib/external-links";
import { BomPdfDocument } from "@/components/BomPdfDocument";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BomEmailEnrichment {
  bomSummaryLines: string[];
  zohoSoUrl?: string;
  zohoSoNumber?: string;
  snapshotVersion?: number;
  pdfAttachment?: { filename: string; content: Buffer };
}

/** Discriminated result so callers can distinguish "no snapshot" from "error". */
export type BomEnrichmentResult =
  | { status: "success"; enrichment: BomEmailEnrichment }
  | { status: "no_snapshot" }
  | { status: "error"; error: unknown };

// ---------------------------------------------------------------------------
// BOM data shape (subset needed for summary building)
// ---------------------------------------------------------------------------

interface BomDataForSummary {
  project: {
    customer?: string;
    systemSizeKwdc?: number | string;
    moduleCount?: number | string;
  };
  items: Array<{
    category: string;
    brand: string | null;
    model: string | null;
    description: string;
    qty: number | string;
    unitSpec?: string | number | null;
    unitLabel?: string | null;
  }>;
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PDF generation timeout (ms). Does not truly cancel CPU work — acceptable
 *  for serverless-scoped best-effort rendering. */
const PDF_TIMEOUT_MS = 5_000;

/** Max PDF size (bytes). Skip attachment if larger. */
const PDF_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Lightweight snapshot existence check (for async fallback trigger)
// ---------------------------------------------------------------------------

/**
 * Check whether any BOM snapshot exists for a deal.
 * Lightweight: only selects `id`, no heavy data parsing.
 */
export async function checkBomSnapshotExists(dealId: string): Promise<boolean> {
  if (!prisma) return false;

  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId },
    select: { id: true },
    orderBy: { version: "desc" },
  });

  return snapshot !== null;
}

// ---------------------------------------------------------------------------
// Full enrichment
// ---------------------------------------------------------------------------

/**
 * Fetch BOM snapshot + SO data + generate PDF for email enrichment.
 *
 * Returns a discriminated result:
 * - `success`: enrichment data ready for email
 * - `no_snapshot`: no BOM snapshot exists for this deal (caller may trigger fallback)
 * - `error`: transient failure (caller should NOT trigger fallback)
 */
export async function getBomEmailEnrichment(
  dealId: string,
  dealName: string,
): Promise<BomEnrichmentResult> {
  if (!prisma) {
    return { status: "error", error: new Error("Database not configured") };
  }

  try {
    // ── 1. Fetch latest snapshot ──
    const snapshot = await prisma.projectBomSnapshot.findFirst({
      where: { dealId },
      orderBy: { version: "desc" },
      select: {
        id: true,
        dealId: true,
        version: true,
        bomData: true,
        zohoSoId: true,
      },
    });

    if (!snapshot) {
      return { status: "no_snapshot" };
    }

    // Defensive: validate dealId ownership
    if (snapshot.dealId !== dealId) {
      return { status: "error", error: new Error(`Snapshot dealId mismatch: expected ${dealId}, got ${snapshot.dealId}`) };
    }

    // ── 2. Get SO info ──
    // Primary: snapshot.zohoSoId
    // Enrich with BomPipelineRun by snapshotId → zohoSoNumber
    let zohoSoUrl: string | undefined;
    let zohoSoNumber: string | undefined;

    if (snapshot.zohoSoId) {
      zohoSoUrl = getZohoSalesOrderUrl(snapshot.zohoSoId);

      // Try to get the SO number from the pipeline run that created this snapshot
      const pipelineRun = await prisma.bomPipelineRun.findFirst({
        where: {
          snapshotId: snapshot.id,
          zohoSoNumber: { not: null },
        },
        select: { zohoSoNumber: true },
        orderBy: { createdAt: "desc" },
      });

      if (pipelineRun?.zohoSoNumber) {
        zohoSoNumber = pipelineRun.zohoSoNumber;
      }
    }

    // ── 3. Parse BOM data → build summary lines ──
    const bomData = snapshot.bomData as unknown as BomDataForSummary;
    const bomSummaryLines = buildBomSummaryLines(bomData);

    // ── 4. Generate BOM PDF (best-effort, 5s timeout, 5MB cap) ──
    let pdfAttachment: { filename: string; content: Buffer } | undefined;

    try {
      const generatedAt = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      const pdfElement = React.createElement(BomPdfDocument, {
        bom: bomData as Parameters<typeof BomPdfDocument>[0]["bom"],
        dealName,
        version: snapshot.version,
        generatedBy: "BOM Pipeline",
        generatedAt,
      }) as React.ReactElement;

      const rawBuffer = await Promise.race([
        renderToBuffer(pdfElement),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("PDF render timeout")), PDF_TIMEOUT_MS),
        ),
      ]);

      const pdfBuffer = Buffer.from(rawBuffer);

      if (pdfBuffer.length <= PDF_MAX_SIZE_BYTES) {
        const safeName = dealName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
        pdfAttachment = {
          filename: `BOM-${safeName}-v${snapshot.version}.pdf`,
          content: pdfBuffer,
        };
      } else {
        console.warn(
          `[bom-enrichment] PDF too large (${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB) — skipping attachment`,
        );
      }
    } catch (pdfErr) {
      console.warn("[bom-enrichment] PDF generation failed (non-fatal):", pdfErr);
    }

    // ── 5. Return enrichment ──
    return {
      status: "success",
      enrichment: {
        bomSummaryLines,
        zohoSoUrl,
        zohoSoNumber,
        snapshotVersion: snapshot.version,
        pdfAttachment,
      },
    };
  } catch (error) {
    // Outer catch: transient failure → return "error" (NOT "no_snapshot")
    return { status: "error", error };
  }
}

// ---------------------------------------------------------------------------
// Summary line builder
// ---------------------------------------------------------------------------

/**
 * Build human-readable summary lines from BOM data.
 * Similar format to `buildEquipmentSummary` in scheduling-email-details.ts
 * but sourced from BOM snapshot rather than HubSpot properties.
 */
function buildBomSummaryLines(bomData: BomDataForSummary): string[] {
  const lines: string[] = [];

  if (!bomData?.items?.length) return lines;

  // Group items by category, pick primary item per category
  const byCategory = new Map<string, typeof bomData.items>();
  for (const item of bomData.items) {
    const existing = byCategory.get(item.category) ?? [];
    existing.push(item);
    byCategory.set(item.category, existing);
  }

  // Modules
  const modules = byCategory.get("MODULE");
  if (modules?.length) {
    const primary = modules[0];
    const qty = Number(primary.qty) || 0;
    const brand = primary.brand || "";
    const model = primary.model || primary.description;
    lines.push(`Modules: ${qty}x ${brand} ${model}`.trim());
  }

  // System size
  if (bomData.project?.systemSizeKwdc) {
    lines.push(`System Size: ${bomData.project.systemSizeKwdc} kWdc`);
  }

  // Inverter
  const inverters = byCategory.get("INVERTER");
  if (inverters?.length) {
    const primary = inverters[0];
    const qty = Number(primary.qty) || 1;
    const brand = primary.brand || "";
    const model = primary.model || primary.description;
    const qtyStr = qty > 1 ? `${qty}x ` : "";
    lines.push(`Inverter: ${qtyStr}${brand} ${model}`.trim());
  }

  // Battery
  const batteries = byCategory.get("BATTERY");
  if (batteries?.length) {
    const primary = batteries[0];
    const qty = Number(primary.qty) || 1;
    const brand = primary.brand || "";
    const model = primary.model || primary.description;
    const qtyStr = qty > 1 ? `${qty}x ` : "";
    lines.push(`Battery: ${qtyStr}${brand} ${model}`.trim());
  }

  // EV Charger
  const evChargers = byCategory.get("EV_CHARGER");
  if (evChargers?.length) {
    const primary = evChargers[0];
    const brand = primary.brand || "";
    const model = primary.model || primary.description;
    lines.push(`EV Charger: ${brand} ${model}`.trim());
  }

  return lines;
}
