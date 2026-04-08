import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import sharp from "sharp";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { eagleView } from "@/lib/eagleview";
import { extractFolderId, getDriveWriteToken } from "@/lib/drive-plansets";
import { hubspotClient } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dealId = request.nextUrl.searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId query parameter is required" }, { status: 400 });
  }

  const record = await prisma.eagleViewImagery.findUnique({ where: { dealId } });

  if (!record) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    imageUrn: record.imageUrn,
    captureDate: record.captureDate,
    gsd: record.gsd,
    thumbnailUrl: record.thumbnailUrl,
    driveFileId: record.driveFileId,
    fetchedAt: record.fetchedAt,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  let body: { dealId?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dealId, force } = body;
  if (!dealId || typeof dealId !== "string") {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

  // Step 1: Check cache
  if (!force) {
    const existing = await prisma.eagleViewImagery.findUnique({ where: { dealId } });
    if (existing) {
      return NextResponse.json({
        cached: true,
        exists: true,
        imageUrn: existing.imageUrn,
        captureDate: existing.captureDate,
        gsd: existing.gsd,
        thumbnailUrl: existing.thumbnailUrl,
        driveFileId: existing.driveFileId,
        fetchedAt: existing.fetchedAt,
      });
    }
  }

  // Step 2: Fetch deal address from HubSpot
  let address: string;
  let designFolderId: string | null;
  try {
    const dealResponse = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "address_line_1", "city", "state", "postal_code",
      "design_documents", "design_document_folder_id", "all_document_parent_folder_id",
    ]);
    const props = dealResponse.properties;
    const line1 = props.address_line_1?.trim();
    const city = props.city?.trim();
    const state = props.state?.trim();
    const zip = props.postal_code?.trim();

    if (!line1 || !city || !state) {
      return NextResponse.json(
        { error: "Deal is missing address fields (address_line_1, city, or state)" },
        { status: 400 },
      );
    }

    address = `${line1}, ${city}, ${state}${zip ? ` ${zip}` : ""}`;

    // Resolve design folder for Drive save
    const folderRaw = String(
      props.design_documents || props.design_document_folder_id || props.all_document_parent_folder_id || "",
    ).trim();
    designFolderId = folderRaw ? extractFolderId(folderRaw) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("404") || msg.includes("not found")) {
      return NextResponse.json({ error: "Deal not found in HubSpot" }, { status: 404 });
    }
    Sentry.captureException(err);
    return NextResponse.json({ error: `HubSpot error: ${msg}` }, { status: 502 });
  }

  // Step 3: Geocode address via Google Maps
  let lat: number;
  let lng: number;
  try {
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`,
      { cache: "no-store" },
    );
    const geoJson = await geoRes.json();
    if (!geoJson.results?.length) {
      return NextResponse.json({ error: `Geocoding failed: no results for "${address}"` }, { status: 400 });
    }
    const location = geoJson.results[0].geometry.location;
    lat = location.lat;
    lng = location.lng;
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: "Geocoding service error" }, { status: 400 });
  }

  // Step 4: Discover best ortho from EagleView
  let bestOrtho: Awaited<ReturnType<typeof eagleView.getBestOrthoForLocation>>;
  try {
    bestOrtho = await eagleView.getBestOrthoForLocation(lat, lng);
  } catch (err) {
    Sentry.captureException(err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `EagleView discovery error: ${msg}` }, { status: 502 });
  }

  if (!bestOrtho) {
    return NextResponse.json(
      { error: "no_imagery", message: "No EagleView imagery available for this location" },
      { status: 404 },
    );
  }

  // Step 5: Download full image (capped at 2048x2048 for manageability)
  let imageBuffer: ArrayBuffer;
  let contentType: string;
  try {
    const result = await eagleView.getImageAtLocation(bestOrtho.imageUrn, lat, lng, {
      size: { width: 2048, height: 2048 },
      format: "png",
    });
    imageBuffer = result.buffer;
    contentType = result.contentType;
  } catch (err) {
    Sentry.captureException(err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `EagleView image fetch error: ${msg}` }, { status: 502 });
  }

  // Step 6: Save to Google Drive (required — retry once on failure)
  let driveFileId: string;
  const driveFolderId = designFolderId;

  if (!driveFolderId) {
    return NextResponse.json(
      { error: "Deal has no design documents folder configured in HubSpot" },
      { status: 400 },
    );
  }

  for (let driveAttempt = 0; driveAttempt < 2; driveAttempt++) {
    try {
      const token = await getDriveWriteToken();
      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const filename = `EagleView_Aerial_${dealId}.${ext}`;

      const boundary = "eagleview_upload_boundary";
      const metadata = JSON.stringify({
        name: filename,
        mimeType: contentType,
        parents: [driveFolderId],
      });

      // Build multipart body
      const metadataPart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
      const filePart = `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
      const closing = `\r\n--${boundary}--`;

      const encoder = new TextEncoder();
      const parts = [
        encoder.encode(metadataPart),
        encoder.encode(filePart),
        new Uint8Array(imageBuffer),
        encoder.encode(closing),
      ];

      const bodyLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
      const bodyArray = new Uint8Array(bodyLength);
      let offset = 0;
      for (const part of parts) {
        bodyArray.set(part, offset);
        offset += part.byteLength;
      }

      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: bodyArray,
          cache: "no-store",
        },
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Drive upload ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as { id: string; name: string };
      driveFileId = data.id;
      break; // Success
    } catch (err) {
      if (driveAttempt === 1) {
        Sentry.captureException(err);
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Drive save failed after retry: ${msg}` }, { status: 502 });
      }
      // First attempt failed — retry
      console.warn("[eagleview] Drive upload failed, retrying:", err);
    }
  }

  // Step 7: Generate thumbnail
  let thumbnailUrl: string | null = null;
  try {
    const thumbnailBuffer = await sharp(Buffer.from(imageBuffer))
      .resize({ width: 300, withoutEnlargement: true })
      .png({ quality: 80 })
      .toBuffer();
    thumbnailUrl = `data:image/png;base64,${thumbnailBuffer.toString("base64")}`;
  } catch (err) {
    // Non-fatal: proceed without thumbnail
    console.warn("[eagleview] Thumbnail generation failed:", err);
  }

  // Step 8: Upsert DB record
  const record = await prisma.eagleViewImagery.upsert({
    where: { dealId },
    create: {
      dealId,
      imageUrn: bestOrtho.imageUrn,
      captureDate: bestOrtho.captureDate ? new Date(bestOrtho.captureDate) : null,
      gsd: bestOrtho.gsd,
      driveFileId: driveFileId!,
      driveFolderId,
      thumbnailUrl,
      fetchedAt: new Date(),
      fetchedBy: user.email,
    },
    update: {
      imageUrn: bestOrtho.imageUrn,
      captureDate: bestOrtho.captureDate ? new Date(bestOrtho.captureDate) : null,
      gsd: bestOrtho.gsd,
      driveFileId: driveFileId!,
      driveFolderId,
      thumbnailUrl,
      fetchedAt: new Date(),
      fetchedBy: user.email,
    },
  });

  return NextResponse.json({
    exists: true,
    imageUrn: record.imageUrn,
    captureDate: record.captureDate,
    gsd: record.gsd,
    thumbnailUrl: record.thumbnailUrl,
    driveFileId: record.driveFileId,
    fetchedAt: record.fetchedAt,
  });
}
