/**
 * POST /api/pe/photo-package/triage
 *
 * Accepts a list of photo URLs (from Vercel Blob), uploads them to Anthropic,
 * batch-triages them against the PE M1 photo checklist, and returns per-photo
 * shot assignments together with a coverage report.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

import { requireApiAuth } from "@/lib/api-auth";
import { listAllProjects } from "@/lib/pe-api";
import {
  normalizeSystemType,
  resolveDealContext,
} from "@/lib/pe-photo-package";
import { uploadToAnthropic, triagePhotoBatch } from "@/lib/pe-vision-classifier";
import { isUsableImage } from "@/lib/pe-photo-submit";
import { computeCoverage } from "@/lib/pe-photo-coverage";
import { PE_M1_CHECKLIST } from "@/lib/pe-turnover";

interface TriagePhotoInput {
  clientId: string;
  name: string;
  blobUrl: string;
}

interface TriagePhotoResult {
  clientId: string;
  name: string;
  shot: string | null;
  verdict: "pass" | "fail" | "needs_review";
  issues: string[];
  equipmentVisible: string[];
}

// Module-level: holds photos that passed the image-quality gate, indexed for Map lookups
interface UsableEntry { clientId: string; name: string; anthropicFileId: string }

/**
 * Run `fn` over `items` with at most `limit` concurrent executions.
 * Result order matches input order.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  // ── Parse body ───────────────────────────────────────────────────────────────
  let code: string | undefined;
  let photos: TriagePhotoInput[] = [];
  try {
    const body = (await req.json()) as {
      code?: string;
      photos?: TriagePhotoInput[];
    };
    code = body.code;
    photos = body.photos ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  if (!photos.length) {
    return NextResponse.json({ error: "photos must be non-empty" }, { status: 400 });
  }

  // ── Resolve PE project ───────────────────────────────────────────────────────
  const allProjects = await listAllProjects();
  const project = allProjects.find((p) => p.projectId === code);
  if (!project) {
    return NextResponse.json({ error: `Project not found: ${code}` }, { status: 404 });
  }
  const systemType = normalizeSystemType(project.assets.systemType);

  // ── Resolve HubSpot deal context ─────────────────────────────────────────────
  const ctx = await resolveDealContext(code);
  if (ctx.ambiguous) {
    return NextResponse.json(
      { error: "Multiple deals matched this PE code — supply peAddress to disambiguate", candidates: ctx.candidates },
      { status: 409 },
    );
  }
  if (!ctx.deal) {
    return NextResponse.json({ error: `No deal found for project: ${code}` }, { status: 404 });
  }
  const soFound = !!ctx.soBuffer;

  // ── Download + filter photos (bounded concurrency: 10 at a time) ─────────────
  const usable: UsableEntry[] = [];
  const results: TriagePhotoResult[] = [];

  // mapLimit preserves index ordering; we use a separate usableIdx for Map lookups below
  type PhotoSlotResult =
    | { kind: "unusable"; result: TriagePhotoResult }
    | { kind: "usable"; entry: UsableEntry };

  const slotResults = await mapLimit<TriagePhotoInput, PhotoSlotResult>(
    photos,
    10,
    async (photo) => {
      try {
        // Fix 1: explicit non-200 check — a 403/404 body would otherwise corrupt sharp
        const res = await fetch(photo.blobUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rawBuf = Buffer.from(await res.arrayBuffer());

        // Check dimensions
        const meta = await sharp(rawBuf).metadata();
        const usability = isUsableImage(meta.width ?? 0, meta.height ?? 0);
        if (!usability.ok) {
          return {
            kind: "unusable",
            result: {
              clientId: photo.clientId,
              name: photo.name,
              shot: null,
              verdict: "needs_review",
              issues: [`image not usable: ${usability.reason ?? "unknown"}`],
              equipmentVisible: [],
            },
          } as PhotoSlotResult;
        }

        // Downscale for Anthropic upload (keep bandwidth low)
        const downscaled = await sharp(rawBuf)
          .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const anthropicFileId = await uploadToAnthropic(downscaled, photo.name, "image/jpeg");

        return {
          kind: "usable",
          entry: { clientId: photo.clientId, name: photo.name, anthropicFileId },
        } as PhotoSlotResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          kind: "unusable",
          result: {
            clientId: photo.clientId,
            name: photo.name,
            shot: null,
            verdict: "needs_review",
            issues: [`fetch/process failed: ${msg}`],
            equipmentVisible: [],
          },
        } as PhotoSlotResult;
      }
    },
  );

  // Partition slot results: push unusable into results[], collect usable[] for triage
  for (const slot of slotResults) {
    if (slot.kind === "unusable") {
      results.push(slot.result);
    } else {
      usable.push(slot.entry);
    }
  }

  // ── Batch triage via vision ──────────────────────────────────────────────────
  const photoChecklistItems = PE_M1_CHECKLIST.filter((i) => i.isPhoto);

  let triageResult: Awaited<ReturnType<typeof triagePhotoBatch>>;
  // triagePhotoBatch currently swallows internal errors and returns an empty Map; this catch is defensive in case that changes.
  try {
    const triageInputs = usable.map((u) => ({
      anthropicFileId: u.anthropicFileId,
      fileName: u.name,
      driveFileId: u.clientId, // opaque key — not actually Drive; only used as identifier
    }));
    triageResult = await triagePhotoBatch(triageInputs, photoChecklistItems);
  } catch (err) {
    console.error("[pe/photo-package/triage] vision error:", err);
    return NextResponse.json(
      { error: "vision service busy, try again" },
      { status: 502 },
    );
  }

  // ── Build results from triage Map ───────────────────────────────────────────
  // Merge usable triage results with pre-skipped unusable records
  for (let i = 0; i < usable.length; i++) {
    const u = usable[i];
    const assignment = triageResult.assignments.get(i);
    if (assignment) {
      results.push({
        clientId: u.clientId,
        name: u.name,
        shot: assignment.checklistId,
        verdict: assignment.verdict,
        issues: assignment.issues,
        equipmentVisible: assignment.equipmentVisible,
      });
    } else {
      results.push({
        clientId: u.clientId,
        name: u.name,
        shot: null,
        verdict: "needs_review",
        issues: ["unmatched — vision could not assign a shot"],
        equipmentVisible: [],
      });
    }
  }

  // ── Compute coverage ─────────────────────────────────────────────────────────
  const flatAssignments = usable.flatMap((_, i) => {
    const a = triageResult.assignments.get(i);
    if (!a) return [];
    return [{ checklistId: a.checklistId, verdict: a.verdict }];
  });
  const coverage = computeCoverage(flatAssignments, systemType, soFound);

  return NextResponse.json({ systemType, soFound, coverage, photos: results });
}
