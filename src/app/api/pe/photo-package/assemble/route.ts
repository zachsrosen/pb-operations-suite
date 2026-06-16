/**
 * POST /api/pe/photo-package/assemble
 *
 * Accepts final photo assignments (clientId → shotId), downloads full-res
 * images, orders them by canonical PE shot sequence, embeds the Sales Order
 * PDF, and returns the assembled PDF as a binary download. Also stages the
 * PDF to Drive in the deal's Participate Energy folder.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/api-auth";
import {
  resolveDealContext,
  buildPhotoPdf,
  type PackagePhoto,
} from "@/lib/pe-photo-package";
import {
  orderPolicyPhotos,
  policyPhotosFilename,
  type ClassifiedPhoto,
} from "@/lib/pe-photo-submit";
import { PE_M1_CHECKLIST } from "@/lib/pe-turnover";
import { findOrCreatePeFolder } from "@/lib/pe-audit-orchestrator";
import { uploadDriveBinaryFile } from "@/lib/drive-plansets";

interface AssignmentInput {
  clientId: string;
  blobUrl: string;
  shotId: string | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  // ── Parse body ───────────────────────────────────────────────────────────────
  let code: string | undefined;
  let assignments: AssignmentInput[] = [];
  try {
    const body = (await req.json()) as {
      code?: string;
      assignments?: AssignmentInput[];
    };
    code = body.code;
    assignments = body.assignments ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  // ── Filter to kept assignments (shotId !== null) ──────────────────────────────
  const kept = assignments.filter((a) => a.shotId !== null);
  if (!kept.length) {
    return NextResponse.json(
      { error: "No assignments with a shotId — nothing to assemble" },
      { status: 400 },
    );
  }

  const warnings: string[] = [];

  // ── Resolve deal context (SO, folder IDs) ────────────────────────────────────
  const ctx = await resolveDealContext(code);

  if (ctx.ambiguous) {
    return NextResponse.json(
      { error: "Multiple deals matched — refine the code.", candidates: ctx.candidates },
      { status: 409 },
    );
  }
  if (!ctx.deal) {
    return NextResponse.json(
      { error: "No deal found for that code, PROJ number, or name." },
      { status: 404 },
    );
  }

  // ── Download full-res buffers ─────────────────────────────────────────────────
  const bufferByClientId = new Map<string, Buffer>();
  await Promise.all(
    kept.map(async (a) => {
      try {
        const res = await fetch(a.blobUrl);
        if (!res.ok) {
          warnings.push(`fetch failed for ${a.clientId}: HTTP ${res.status}`);
          return;
        }
        bufferByClientId.set(a.clientId, Buffer.from(await res.arrayBuffer()));
      } catch (err) {
        warnings.push(
          `fetch error for ${a.clientId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // ── Order photos by canonical PE shot sequence ────────────────────────────────
  const classified: ClassifiedPhoto[] = kept
    .filter((a) => bufferByClientId.has(a.clientId))
    .map((a) => ({ fileId: a.clientId, shotId: a.shotId! }));

  const ordered = orderPolicyPhotos(classified);

  // ── Build caption lookup (pePhotoNumber + label) from checklist ───────────────
  const checklistById = new Map(PE_M1_CHECKLIST.map((i) => [i.id, i]));

  const packagePhotos: PackagePhoto[] = ordered
    .map((o) => {
      const buf = bufferByClientId.get(o.fileId);
      if (!buf) return null;
      const item = checklistById.get(o.shotId);
      const caption = item
        ? `${item.pePhotoNumber ?? ""} — ${item.label}`
        : o.shotId;
      return { buffer: buf, caption };
    })
    .filter((p): p is PackagePhoto => p !== null);

  // ── Determine soInsertIndex ────────────────────────────────────────────────────
  // SO is inserted before the first photo whose shot rank >= rank(6_invoice_bom).
  // In practice: SO goes between photo 5 (MSP) and photo 6 (Invoice/BOM).
  //
  // Invariant: `ordered` and `packagePhotos` are 1:1 because `classified` is
  // pre-filtered to entries present in `bufferByClientId`, and `packagePhotos`
  // maps `ordered` with the same filter (null-entries are filtered out, but those
  // would only appear if bufferByClientId somehow lost an entry between the two
  // passes — impossible since the Map is never mutated after population). Therefore
  // soInsertIndex computed over `ordered` is a valid index into `packagePhotos`.
  const SO_SHOT_ID = "m1.photos.6_invoice_bom";
  const allPhotoShots = PE_M1_CHECKLIST.filter((i) => i.isPhoto);
  const rankOf = new Map(allPhotoShots.map((item, idx) => [item.id, idx]));
  const soRank = rankOf.get(SO_SHOT_ID) ?? Infinity;

  // Count how many ordered photos have a shot rank strictly less than the SO rank
  let soInsertIndex = ordered.filter((o) => (rankOf.get(o.shotId) ?? Infinity) < soRank).length;
  // Clamp to valid range
  if (soInsertIndex > packagePhotos.length) soInsertIndex = packagePhotos.length;

  // ── Build PDF ────────────────────────────────────────────────────────────────
  const bytes = await buildPhotoPdf(
    packagePhotos,
    ctx.soBuffer ?? null,
    soInsertIndex,
    (err) => warnings.push(`SO embed failed: ${err.message}`),
  );

  // ── Stage to Drive ───────────────────────────────────────────────────────────
  const addr = {
    street: ctx.deal?.properties.address_line_1 ?? undefined,
    city: ctx.deal?.properties.city ?? undefined,
  };
  const filename = policyPhotosFilename(addr);

  if (ctx.rootFolderId) {
    try {
      const peFolderId = await findOrCreatePeFolder(ctx.rootFolderId);
      await uploadDriveBinaryFile(peFolderId, filename, bytes, "application/pdf");
    } catch (err) {
      warnings.push(
        `Drive staging failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    warnings.push("Drive staging skipped: no rootFolderId resolved");
  }

  // ── Return PDF ───────────────────────────────────────────────────────────────
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-pe-warnings": JSON.stringify(warnings),
    },
  });
}
