// src/app/api/bom/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/db";
import { BomPdfDocument } from "@/components/BomPdfDocument";
import React from "react";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // authResult is AuthenticatedUser — email is a direct string property
  const { email } = authResult;

  let body: {
    snapshotId?: string;
    bomData?: unknown;
    dealName?: string;
    version?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let bomData: unknown = body.bomData;
  let dealName: string | undefined = body.dealName;
  let version: number | undefined = body.version;

  if (body.snapshotId) {
    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }
    const snap = await prisma.projectBomSnapshot.findUnique({
      where: { id: body.snapshotId },
      select: { bomData: true, dealName: true, version: true },
    });
    if (!snap) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    bomData = snap.bomData;
    dealName = snap.dealName;
    version = snap.version;
  }

  if (!bomData) {
    return NextResponse.json({ error: "bomData required" }, { status: 400 });
  }

  const generatedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const safeName = (dealName ?? "BOM").replace(/[^a-z0-9_-]/gi, "_");
  const filename = version
    ? `BOM-${safeName}-v${version}.pdf`
    : `BOM-${safeName}.pdf`;

  try {
    // BomPdfDocument renders a <Document> root. Cast to satisfy renderToBuffer's
    // ReactElement<DocumentProps> signature — the runtime shape is correct.
    const element = React.createElement(BomPdfDocument, {
      bom: bomData as Parameters<typeof BomPdfDocument>[0]["bom"],
      dealName,
      version,
      generatedBy: email,
      generatedAt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as React.ReactElement<any>;

    const buffer = await renderToBuffer(element);

    // Buffer is a Node.js subclass of Uint8Array; wrap in Blob for NextResponse
    // compatibility with the edge/fetch-based BodyInit type.
    const blob = new Blob([new Uint8Array(buffer)], { type: "application/pdf" });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (e) {
    console.error("[bom/export-pdf]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PDF generation failed" },
      { status: 500 }
    );
  }
}
