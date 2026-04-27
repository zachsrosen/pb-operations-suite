/**
 * End-to-end verification of the M3.4 catalog-sync fix.
 *
 * Phase 1 (READ-ONLY, default): picks a Zuper-linked InternalProduct with at
 * least one populated spec, fetches the live Zuper product, prints the
 * `meta_data` shape, and prints what `mergeZuperMetaData` would produce for
 * a no-op replay (replacing one entry with itself). Verifies our merge
 * helper preserves cross-link IDs and the existing meta_data shape.
 *
 * Phase 2 (WRITE, opt-in via --write): actually PUTs the merged meta_data
 * back to Zuper (no-op replay), re-fetches, and asserts:
 *   - the spec entry's value is unchanged
 *   - the cross-link entries (HubSpot Product ID, Internal Product ID) are intact
 *   - no entries were dropped or appended
 *
 * Run:
 *   node --env-file=.env.local --import tsx scripts/_verify-m34-update-path.ts
 *   node --env-file=.env.local --import tsx scripts/_verify-m34-update-path.ts --write
 *   node --env-file=.env.local --import tsx scripts/_verify-m34-update-path.ts --product=<internalProductId>
 */
import { prisma } from "@/lib/db";
import { getCategoryFields } from "@/lib/catalog-fields";
import {
  getZuperPartById,
  updateZuperPart,
  buildZuperMetaDataEntry,
  mergeZuperMetaData,
  type ZuperMetaDataEntry,
} from "@/lib/zuper-catalog";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const PRODUCT_ARG = args.find((a) => a.startsWith("--product="))?.split("=")[1];

if (!process.env.ZUPER_API_KEY) {
  console.error("ZUPER_API_KEY not set");
  process.exit(1);
}

interface SpecCandidate {
  productId: string;
  category: string;
  zuperItemId: string;
  fieldKey: string;
  zuperLabel: string;
  fieldType: string;
  currentValue: unknown;
}

/**
 * Find an InternalProduct that:
 *   - is linked to Zuper (zuperItemId set)
 *   - is in a category whose FieldDef set has at least one zuperCustomField
 *   - has at least one populated spec value matching such a FieldDef
 */
async function pickCandidate(): Promise<SpecCandidate | null> {
  if (!prisma) {
    throw new Error("prisma not configured");
  }
  const where = PRODUCT_ARG
    ? { id: PRODUCT_ARG }
    : { zuperItemId: { not: null }, isActive: true };

  const products = await prisma.internalProduct.findMany({
    where,
    take: PRODUCT_ARG ? 1 : 200,
    orderBy: { updatedAt: "desc" },
    include: {
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
  });

  for (const p of products) {
    if (!p.zuperItemId) continue;
    const fields = getCategoryFields(p.category as string);
    if (fields.length === 0) continue;

    // Try each spec table for the category — pick the first FieldDef whose
    // value is populated.
    const specSources: Array<Record<string, unknown> | null | undefined> = [
      p.moduleSpec as unknown as Record<string, unknown> | null,
      p.inverterSpec as unknown as Record<string, unknown> | null,
      p.batterySpec as unknown as Record<string, unknown> | null,
      p.evChargerSpec as unknown as Record<string, unknown> | null,
      p.mountingHardwareSpec as unknown as Record<string, unknown> | null,
      p.electricalHardwareSpec as unknown as Record<string, unknown> | null,
      p.relayDeviceSpec as unknown as Record<string, unknown> | null,
    ];

    for (const spec of specSources) {
      if (!spec) continue;
      for (const f of fields) {
        if (!f.zuperCustomField) continue;
        const v = spec[f.key];
        if (v === null || v === undefined || v === "") continue;
        return {
          productId: p.id,
          category: p.category as string,
          zuperItemId: p.zuperItemId,
          fieldKey: f.key,
          zuperLabel: f.zuperCustomField,
          fieldType: f.type,
          currentValue: v,
        };
      }
    }
  }

  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  console.log("=".repeat(72));
  console.log("M3.4 update-path verification");
  console.log(`Mode: ${WRITE ? "WRITE (will PUT to Zuper)" : "READ-ONLY"}`);
  console.log("=".repeat(72));

  const candidate = await pickCandidate();
  if (!candidate) {
    console.error("No suitable Zuper-linked InternalProduct with a populated spec was found.");
    process.exit(1);
  }

  console.log("\n[1] Candidate:");
  console.log(`    InternalProduct.id : ${candidate.productId}`);
  console.log(`    category           : ${candidate.category}`);
  console.log(`    zuperItemId        : ${candidate.zuperItemId}`);
  console.log(`    spec FieldDef.key  : ${candidate.fieldKey}`);
  console.log(`    zuperCustomField   : ${candidate.zuperLabel}`);
  console.log(`    field type         : ${candidate.fieldType}`);
  console.log(`    current DB value   : ${JSON.stringify(candidate.currentValue)}`);

  console.log("\n[2] Fetching live Zuper product...");
  const part = await getZuperPartById(candidate.zuperItemId);
  if (!part) {
    console.error(`Zuper returned no product for ${candidate.zuperItemId}`);
    process.exit(1);
  }
  const partRecord = part as Record<string, unknown>;
  const currentMeta = (partRecord.meta_data as unknown[] | undefined) ?? [];
  console.log(`    meta_data entries  : ${currentMeta.length}`);

  // Look for the entry matching our spec label and the cross-link entries.
  const labelEntry = (currentMeta as ZuperMetaDataEntry[]).find(
    (e) => e?.label === candidate.zuperLabel,
  );
  const crossLinkEntries = (currentMeta as ZuperMetaDataEntry[]).filter((e) =>
    typeof e?.label === "string" &&
    /HubSpot Product ID|Internal Product ID|Zoho Item ID/i.test(e.label),
  );
  console.log(`    spec label found?  : ${labelEntry ? "yes" : "no"}`);
  if (labelEntry) {
    console.log(`    spec entry         : ${JSON.stringify(labelEntry)}`);
  }
  console.log(`    cross-link entries : ${crossLinkEntries.length}`);
  for (const e of crossLinkEntries) {
    console.log(`      - ${JSON.stringify(e)}`);
  }

  console.log("\n[3] Building no-op replay entry via buildZuperMetaDataEntry...");
  const fields = getCategoryFields(candidate.category);
  const fieldDef = fields.find((f) => f.key === candidate.fieldKey)!;
  const replay = buildZuperMetaDataEntry(fieldDef, candidate.currentValue);
  console.log(`    replay entry       : ${JSON.stringify(replay)}`);

  console.log("\n[4] Computing merged meta_data via mergeZuperMetaData...");
  const merged = mergeZuperMetaData(currentMeta, [replay]);
  console.log(`    merged length      : ${merged.length} (current: ${currentMeta.length})`);

  // Sanity assertions for read-only phase.
  let ok = true;

  if (merged.length !== currentMeta.length && !labelEntry) {
    // append-when-missing case is fine
    console.log("    note: spec label was not present, so merge appended a new entry (expected)");
  } else if (merged.length !== currentMeta.length) {
    console.log(`    ✗ merged length differs from current — entries were dropped`);
    ok = false;
  }

  // Every cross-link entry must be present byte-for-byte in merged.
  for (const xl of crossLinkEntries) {
    const survived = merged.some((e) => deepEqual(e, xl));
    if (!survived) {
      console.log(`    ✗ cross-link entry was lost: ${JSON.stringify(xl)}`);
      ok = false;
    }
  }
  if (crossLinkEntries.length > 0 && ok) {
    console.log(`    ✓ all ${crossLinkEntries.length} cross-link entries preserved in merged array`);
  }

  // The spec label appears exactly once in merged.
  const specHits = merged.filter((e) => e?.label === candidate.zuperLabel).length;
  if (specHits !== 1) {
    console.log(`    ✗ spec label "${candidate.zuperLabel}" appears ${specHits}× in merged (expected 1)`);
    ok = false;
  } else {
    console.log(`    ✓ spec label "${candidate.zuperLabel}" appears exactly once in merged`);
  }

  if (!ok) {
    console.error("\nRead-only checks FAILED — not proceeding to write phase.");
    process.exit(2);
  }

  console.log("\n[5] Read-only verification PASSED.");
  if (!WRITE) {
    console.log("\nRe-run with --write to actually PUT the merged array to Zuper.");
    return;
  }

  console.log("\n[6] WRITE phase — PUTting merged meta_data to Zuper...");
  const result = await updateZuperPart(candidate.zuperItemId, { meta_data: merged });
  console.log(`    updateZuperPart status: ${result.status}`);
  console.log(`    message              : ${result.message}`);
  if (result.status !== "updated") {
    console.error("Write failed.");
    process.exit(3);
  }

  console.log("\n[7] Re-fetching to confirm round-trip...");
  const refetched = await getZuperPartById(candidate.zuperItemId);
  const refetchedMeta =
    ((refetched as Record<string, unknown> | null | undefined)?.meta_data as
      ZuperMetaDataEntry[] | undefined) ?? [];

  const newSpecEntry = refetchedMeta.find((e) => e?.label === candidate.zuperLabel);
  console.log(`    refetched spec     : ${JSON.stringify(newSpecEntry)}`);

  let postOk = true;
  if (!newSpecEntry) {
    console.log("    ✗ spec label is missing after PUT");
    postOk = false;
  } else if (String(newSpecEntry.value) !== String(candidate.currentValue)) {
    console.log(
      `    ✗ spec value changed unexpectedly: ${String(newSpecEntry.value)} (expected ${String(candidate.currentValue)})`,
    );
    postOk = false;
  } else {
    console.log(`    ✓ spec value preserved`);
  }

  for (const xl of crossLinkEntries) {
    const survived = refetchedMeta.some(
      (e) => e?.label === xl.label && String(e?.value) === String(xl.value),
    );
    if (!survived) {
      console.log(`    ✗ cross-link entry dropped after PUT: ${JSON.stringify(xl)}`);
      postOk = false;
    }
  }
  if (crossLinkEntries.length > 0 && postOk) {
    console.log(`    ✓ all ${crossLinkEntries.length} cross-link entries still present after PUT`);
  }

  if (!postOk) {
    console.error("\nPost-write checks FAILED.");
    process.exit(4);
  }

  console.log("\n[8] WRITE verification PASSED.");
}

main()
  .catch((err) => {
    console.error("Verification crashed:", err);
    process.exit(99);
  })
  .finally(() => {
    if (prisma) void prisma.$disconnect();
  });
