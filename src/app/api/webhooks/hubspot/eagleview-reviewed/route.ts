/**
 * POST /api/webhooks/hubspot/eagleview-reviewed
 *
 * Fired by the HubSpot workflow when a designer's task completes and
 * `eagleview_status` flips to "Reviewed". Pulls the completed TrueDesign design
 * exports (DXF/DWG/PDF) into the deal's Drive folder and records the file IDs.
 *
 * Auth: HubSpot v3 webhook signature (same validator as eagleview-tdp-order), so
 * the workflow "Send a webhook" action needs no custom header / Authentication = None.
 * Gated by SystemConfig flag `eagleview_truedesign_pull_enabled = "true"`.
 *
 * Body: { dealId?: string, reportId?: string, objectId?: string|number }
 * (configure the HubSpot action's request body to send dealId = the deal Record ID)
 */
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { validateHubSpotWebhook } from "@/lib/hubspot-webhook-auth";
import { defaultPipelineDeps } from "@/lib/eagleview-pipeline-deps";
import {
  listDesignVersionIds,
  getExportDownloadUrl,
  downloadDesignFile,
  TRUEDESIGN_FORMATS,
  type TrueDesignFormat,
} from "@/lib/eagleview-truedesign";

export const maxDuration = 300;

const PULL_FORMATS: TrueDesignFormat[] = ["dxf", "dwg", "pdf"];

async function pullEnabled(): Promise<boolean> {
  if (process.env.EAGLEVIEW_TRUEDESIGN_PULL_ENABLED === "true") return true;
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: "eagleview_truedesign_pull_enabled" },
    });
    return row?.value === "true";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Auth: HubSpot v3 webhook signature (same as the eagleview-tdp-order webhook).
  // The HubSpot workflow "Send a webhook" action signs requests automatically,
  // so the action's Authentication type can stay "None".
  const validation = validateHubSpotWebhook({
    rawBody,
    signature: request.headers.get("x-hubspot-signature-v3") ?? "",
    timestamp: request.headers.get("x-hubspot-request-timestamp") ?? "",
    requestUrl: request.url,
    method: "POST",
  });
  if (!validation.valid) {
    console.warn(`[eagleview-reviewed] auth fail: ${validation.error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (!(await pullEnabled())) {
    return NextResponse.json({ status: "disabled" });
  }

  let body: { dealId?: string; reportId?: string; objectId?: string | number };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dealId = (body.dealId ?? (body.objectId != null ? String(body.objectId) : "")).trim();
  let reportId = (body.reportId ?? "").trim();

  // Resolve the order (and thus the reportId) from the deal if needed.
  const order = reportId
    ? await prisma.eagleViewOrder.findUnique({ where: { reportId } })
    : dealId
      ? await prisma.eagleViewOrder.findFirst({
          where: { dealId, productCode: "TDP" },
          orderBy: { orderedAt: "desc" },
        })
      : null;

  if (!order) {
    return NextResponse.json({ error: "order_not_found", dealId, reportId }, { status: 404 });
  }
  reportId = order.reportId;
  if (reportId.startsWith("pending:")) {
    return NextResponse.json({ error: "order_not_placed", reportId }, { status: 409 });
  }

  const deps = defaultPipelineDeps();

  try {
    // 1. Latest design version
    const versions = await listDesignVersionIds(reportId);
    const versionId = versions[0];
    if (!versionId) {
      return NextResponse.json({ status: "no_design_version", reportId });
    }

    // 2. Resolve the Drive folder (reuse the EagleView delivery folder logic)
    const dealFields = await deps.fetchDealAddress(order.dealId);
    const parentFolderId =
      dealFields?.driveDesignDocumentsFolderId ?? dealFields?.driveAllDocumentsFolderId ?? null;
    if (!parentFolderId) {
      return NextResponse.json({ error: "drive_folder_missing", reportId }, { status: 422 });
    }
    const driveFolderId = await deps.ensureDriveFolder(
      order.dealId,
      parentFolderId,
      `eagleview-${reportId}`,
    );

    // 3. Pull each format → Drive → collect file ids
    const fileIdByColumn: Record<string, string> = {};
    const pulled: string[] = [];
    for (const format of PULL_FORMATS) {
      try {
        const url = await getExportDownloadUrl(format, reportId, versionId);
        const bytes = await downloadDesignFile(url);
        const meta = TRUEDESIGN_FORMATS[format];
        const uploaded = await deps.uploadToDrive(
          driveFolderId,
          `SolarDesign-${reportId}.${meta.ext}`,
          bytes,
          meta.mime,
        );
        fileIdByColumn[meta.column] = uploaded.id;
        pulled.push(format);
      } catch (e) {
        Sentry.captureException(e, {
          tags: { feature: "eagleview-truedesign", phase: "pull", format },
          extra: { reportId },
        });
      }
    }

    if (pulled.length === 0) {
      return NextResponse.json({ status: "no_files_pulled", reportId }, { status: 502 });
    }

    await prisma.eagleViewOrder.update({
      where: { id: order.id },
      data: {
        ...fileIdByColumn,
        designVersionId: versionId,
        designFilesPulledAt: new Date(),
        driveFolderId,
      },
    });

    return NextResponse.json({ status: "pulled", reportId, formats: pulled, versionId });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { feature: "eagleview-truedesign", phase: "webhook" },
      extra: { reportId, dealId },
    });
    return NextResponse.json(
      { error: "pull_failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
