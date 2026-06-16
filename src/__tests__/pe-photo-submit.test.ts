/**
 * Tests for src/lib/pe-photo-submit.ts
 *
 * pe-turnover is mocked to avoid the Prisma/Zuper import chain in Jest.
 * The mock provides the real photo checklist items (ids + appliesTo) so
 * orderPolicyPhotos tests exercise actual ordering logic.
 */

// Must be hoisted before any imports that pull in pe-turnover
jest.mock("@/lib/pe-turnover", () => {
  const ALL = ["solar", "battery", "solar+battery"];
  const SOLAR = ["solar", "solar+battery"];
  const STORAGE = ["battery", "solar+battery"];

  const PE_M1_CHECKLIST = [
    { id: "m1.photos.1_site_address",    isPhoto: true,  appliesTo: ALL },
    { id: "m1.photos.2_pv_array",        isPhoto: true,  appliesTo: SOLAR },
    { id: "m1.photos.3_module_nameplate",isPhoto: true,  appliesTo: SOLAR },
    { id: "m1.photos.4_electrical",      isPhoto: true,  appliesTo: ALL },
    { id: "m1.photos.5_msp",             isPhoto: true,  appliesTo: ALL },
    { id: "m1.photos.6_invoice_bom",     isPhoto: true,  appliesTo: ALL },
    { id: "m1.photos.7_inverter",        isPhoto: true,  appliesTo: SOLAR },
    { id: "m1.photos.8_racking",         isPhoto: true,  appliesTo: SOLAR },
    { id: "m1.photos.9_storage_wide",    isPhoto: true,  appliesTo: STORAGE },
    { id: "m1.photos.10_storage_nameplate", isPhoto: true, appliesTo: STORAGE },
    { id: "m1.photos.11_storage_controller", isPhoto: true, appliesTo: STORAGE },
  ];

  function filterChecklist(
    checklist: Array<{ id: string; isPhoto: boolean; appliesTo: string[] }>,
    systemType: string,
  ) {
    return checklist.filter((item) => item.appliesTo.includes(systemType));
  }

  return { PE_M1_CHECKLIST, filterChecklist };
});

import {
  DOC_CONFIGS,
  finalPermitFilename,
  policyPhotosFilename,
  isUsableImage,
  pickDealByAddress,
  orderPolicyPhotos,
  parseTarget,
} from "@/lib/pe-photo-submit";

// ---------------------------------------------------------------------------
// Task 1: DOC_CONFIGS
// ---------------------------------------------------------------------------

describe("DOC_CONFIGS", () => {
  it("maps final-permit to inspection/permit folder props (fallback numbered 6/3) and the signedFinalPermit key", () => {
    const c = DOC_CONFIGS["final-permit"];
    expect(c.folderProps).toEqual(["inspection_documents", "permit_documents"]);
    expect(c.sourceFolders).toEqual(["6", "3"]);
    expect(c.peDocKey).toBe("signedFinalPermit");
    expect(c.embedsSalesOrder).toBe(false);
  });

  it("maps policy-photos to the installation_documents folder prop (fallback numbered 5), photos key, SO embed", () => {
    const c = DOC_CONFIGS["policy-photos"];
    expect(c.folderProps).toEqual(["installation_documents"]);
    expect(c.sourceFolders).toEqual(["5"]);
    expect(c.peDocKey).toBe("photos");
    expect(c.embedsSalesOrder).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 2: Filename derivation
// ---------------------------------------------------------------------------

describe("filename derivation", () => {
  it("builds the final-permit filename from code + last name", () => {
    expect(finalPermitFilename("CO2605-TORP2", "Torpey")).toBe("CO2605-TORP2_Torpey_Final_Permit.pdf");
  });

  it("builds the policy-photos filename from structured PE address", () => {
    expect(policyPhotosFilename({ street: "295 Via Piedras Blancas", city: "San Simeon" }))
      .toBe("295 Via Piedras Blancas_San Simeon.pdf");
  });

  it("sanitizes path-hostile characters and trims", () => {
    expect(policyPhotosFilename({ street: " 102 S/Tanager Ct ", city: "Louisville " }))
      .toBe("102 S_Tanager Ct_Louisville.pdf");
  });

  it("falls back to UNKNOWN when address is missing", () => {
    expect(policyPhotosFilename({ street: "", city: "" })).toBe("UNKNOWN_address.pdf");
  });
});

// ---------------------------------------------------------------------------
// Task 3: Low-res / sliver image detection
// ---------------------------------------------------------------------------

describe("isUsableImage", () => {
  it("rejects the Torpey sliver (661x111)", () => {
    expect(isUsableImage(661, 111).ok).toBe(false);
  });
  it("accepts a normal screenshot/photo", () => {
    expect(isUsableImage(1300, 800).ok).toBe(true);
  });
  it("rejects a tiny thumbnail", () => {
    expect(isUsableImage(120, 90).ok).toBe(false);
  });
  it("gives a reason when rejected", () => {
    expect(isUsableImage(661, 111).reason).toMatch(/aspect|small/i);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Deal disambiguation by PE address
// ---------------------------------------------------------------------------

const deals = [
  { id: "1", address: "1365 Georgetown Rd, Boulder, CO 80305" },
  { id: "2", address: "2605 Kohler Dr, Boulder, CO 80305" },
];

describe("pickDealByAddress", () => {
  it("returns the single deal when only one", () => {
    expect(pickDealByAddress([deals[0]], "1365 Georgetown Rd").deal?.id).toBe("1");
  });
  it("matches on street number + name", () => {
    const r = pickDealByAddress(deals, "1365 Georgetown Rd");
    expect(r.deal?.id).toBe("1");
    expect(r.ambiguous).toBe(false);
  });
  it("flags ambiguous when nothing matches the PE address", () => {
    const r = pickDealByAddress(deals, "999 Nowhere St");
    expect(r.ambiguous).toBe(true);
    expect(r.deal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 5: Shot ordering for policy photos
// ---------------------------------------------------------------------------

describe("orderPolicyPhotos", () => {
  const photos = [
    { fileId: "a", shotId: "m1.photos.3_module_nameplate" },
    { fileId: "b", shotId: "m1.photos.1_site_address" },
    { fileId: "c", shotId: "m1.photos.2_pv_array" },
    { fileId: "d", shotId: "m1.photos.2_pv_array" }, // a shot can repeat
  ];
  it("orders by canonical shot sequence, keeping repeats in input order", () => {
    const out = orderPolicyPhotos(photos, "solar");
    expect(out.map((p) => p.fileId)).toEqual(["b", "c", "d", "a"]);
  });
  it("keeps every photo matched to a real shot, ordered canonically (no system-type drop)", () => {
    // The vision only assigns a shot when its equipment is present, so we keep
    // all matched photos and order by the full canonical sequence.
    const mixed = [
      { fileId: "x", shotId: "m1.photos.9_storage_wide" },   // rank 8
      { fileId: "y", shotId: "m1.photos.4_electrical" },     // rank 3 — applies to battery too
    ];
    const out = orderPolicyPhotos(mixed, "battery");
    expect(out.map((p) => p.fileId)).toEqual(["y", "x"]);
  });
  it("drops only photos whose shotId is not a real photo shot", () => {
    const out = orderPolicyPhotos(
      [
        { fileId: "keep", shotId: "m1.photos.1_site_address" },
        { fileId: "junk", shotId: "not-a-real-shot" },
      ],
      "solar",
    );
    expect(out.map((p) => p.fileId)).toEqual(["keep"]);
  });
});

// ---------------------------------------------------------------------------
// Task 6: Target argument parsing
// ---------------------------------------------------------------------------

describe("parseTarget", () => {
  it("parses a single PROJ/PE code", () => {
    expect(parseTarget({ project: "CO2605-TORP2" })).toEqual({ mode: "single", value: "CO2605-TORP2" });
  });
  it("parses batch-recent with default 24h, current user", () => {
    expect(parseTarget({ batch: "recent" })).toEqual({ mode: "recent", hours: 24, mineOnly: true });
  });
  it("honors an explicit hours window", () => {
    expect(parseTarget({ batch: "recent", hours: 48 })).toEqual({ mode: "recent", hours: 48, mineOnly: true });
  });
  it("parses an explicit comma list", () => {
    expect(parseTarget({ batch: "CO2605-TORP2,CO2604-MURR9" }))
      .toEqual({ mode: "list", codes: ["CO2605-TORP2", "CO2604-MURR9"] });
  });
  it("throws when no target is given", () => {
    expect(() => parseTarget({})).toThrow(/project or batch/i);
  });
});
