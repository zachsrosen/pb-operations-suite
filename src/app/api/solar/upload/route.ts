/**
 * POST /api/solar/upload
 *
 * Proxy upload: validate file then store to Vercel Blob.
 *
 * Validates:
 * - Extension (.json, .dxf, .zip, .csv)
 * - MIME type
 * - Magic bytes / content structure
 * - Size (50MB max)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, validateCsrfHeader, checkSolarRateLimit } from "@/lib/solar-auth";

// Allowed file types with their validation rules
const ALLOWED_TYPES: Record<string, { mimes: string[]; validate: (buf: Buffer) => boolean }> = {
  ".json": {
    mimes: ["application/json"],
    validate: (buf) => {
      try {
        JSON.parse(buf.toString("utf-8"));
        return true;
      } catch {
        return false;
      }
    },
  },
  ".dxf": {
    mimes: ["application/dxf", "application/octet-stream", "text/plain"],
    validate: (buf) => {
      const text = buf.toString("utf-8", 0, Math.min(buf.length, 4096));
      return text.includes("SECTION") && text.includes("ENTITIES");
    },
  },
  ".zip": {
    mimes: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
    validate: (buf) => {
      // PK magic bytes: 50 4B 03 04
      return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    },
  },
  ".csv": {
    mimes: ["text/csv", "application/csv", "text/plain", "application/octet-stream"],
    validate: (buf) => {
      // Check that first line looks like a CSV header (has commas)
      const firstLine = buf.toString("utf-8", 0, Math.min(buf.length, 1024)).split("\n")[0];
      return firstLine.includes(",");
    },
  },
};

export async function POST(req: NextRequest) {
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Size check — 50MB max
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (50MB max)" }, { status: 413 });
  }

  // Extension check
  const name = file.name.toLowerCase();
  const ext = "." + name.split(".").pop();
  const typeConfig = ALLOWED_TYPES[ext];

  if (!typeConfig) {
    return NextResponse.json(
      { error: `Invalid file type. Allowed: ${Object.keys(ALLOWED_TYPES).join(", ")}` },
      { status: 400 }
    );
  }

  // MIME check
  if (!typeConfig.mimes.includes(file.type)) {
    return NextResponse.json(
      { error: `Invalid MIME type: ${file.type}` },
      { status: 400 }
    );
  }

  // Content validation (magic bytes / structure)
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (!typeConfig.validate(buffer)) {
    return NextResponse.json(
      { error: `File content validation failed for ${ext}` },
      { status: 400 }
    );
  }

  // Upload to Vercel Blob
  // Note: requires @vercel/blob package. If not available, return the validation result
  // and let the client handle storage, or install the package.
  try {
    const { put } = await import("@vercel/blob");
    const blob = await put(`solar/${Date.now()}-${file.name}`, buffer, {
      access: "public",
      contentType: file.type,
    });

    return NextResponse.json({
      data: {
        url: blob.url,
        filename: file.name,
        size: file.size,
        contentType: file.type,
      },
    });
  } catch (err) {
    // If @vercel/blob is not configured, return a placeholder response
    console.error("Blob upload error:", err);
    return NextResponse.json(
      { error: "File storage not configured. Contact admin." },
      { status: 503 }
    );
  }
}
