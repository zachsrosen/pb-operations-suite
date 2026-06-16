// ---------------------------------------------------------------------------
// PE Photo Checklist — client-safe static data.
// NO server imports. Import this from "use client" components.
// Server-side code should continue importing from "@/lib/pe-turnover"
// (which re-exports everything here).
// ---------------------------------------------------------------------------

export type SystemType = "solar" | "battery" | "solar+battery";

export interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  milestone: "m1" | "m2";
  appliesTo: SystemType[];
  driveFolders: string[];
  searchAllFolders: boolean;
  fileHints: string[];
  combinedWith?: string[];
  isPhoto: boolean;
  pePhotoNumber?: number;
}

// ---------------------------------------------------------------------------
// System type shorthands
// ---------------------------------------------------------------------------

const ALL: SystemType[] = ["solar", "battery", "solar+battery"];
const SOLAR: SystemType[] = ["solar", "solar+battery"];
const STORAGE: SystemType[] = ["battery", "solar+battery"];

// ---------------------------------------------------------------------------
// M1 Checklist — Inspection Complete
// ---------------------------------------------------------------------------

export const PE_M1_CHECKLIST: ChecklistItem[] = [
  // --- Contract & Proposal ---
  {
    id: "m1.contract.customer_agreement",
    label: "Countersigned Customer Agreement",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["customer agreement", "ca_signed", "contract_package", "contract"],
    combinedWith: ["m1.contract.installation_order", "m1.contract.disclosures"],
    isPhoto: false,
  },
  {
    id: "m1.contract.installation_order",
    label: "Countersigned Installation Order",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["installation order", "io_signed", "contract_package"],
    combinedWith: ["m1.contract.customer_agreement", "m1.contract.disclosures"],
    isPhoto: false,
  },
  {
    id: "m1.contract.disclosures",
    label: "Required Disclosures",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["disclosure", "contract_package"],
    combinedWith: ["m1.contract.customer_agreement", "m1.contract.installation_order"],
    isPhoto: false,
  },
  {
    id: "m1.contract.proposal",
    label: "Signed Proposal",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["proposal", "quote"],
    isPhoto: false,
  },
  {
    id: "m1.contract.utility_bill",
    label: "Utility Bill (12mo usage)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["utility bill", "utility_bill", "electric bill", "xcel", "usage"],
    isPhoto: false,
  },
  {
    id: "m1.contract.loan_docs",
    label: "Loan Documents (if applicable)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["loan", "sunraise", "financing"],
    isPhoto: false,
  },
  {
    id: "m1.contract.incentive_forms",
    label: "Incentive Forms (if applicable)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0", "8"],
    searchAllFolders: false,
    fileHints: ["incentive", "rebate", "3ce", "xcel_rebate"],
    isPhoto: false,
  },

  // --- Design Package ---
  {
    id: "m1.design.planset",
    label: "Final Plan Set",
    category: "design",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["2"],
    searchAllFolders: false,
    fileHints: [], // uses pickBestPlanset() instead of hints
    isPhoto: false,
  },

  // --- Photos (PE numbered 1-11) ---
  {
    id: "m1.photos.1_site_address",
    label: "Site address + home",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["address", "exterior", "front", "street"],
    isPhoto: true,
    pePhotoNumber: 1,
  },
  {
    id: "m1.photos.2_pv_array",
    label: "Wide-angle PV array",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["array", "modules", "panels", "roof"],
    isPhoto: true,
    pePhotoNumber: 2,
  },
  {
    id: "m1.photos.3_module_nameplate",
    label: "Module nameplate label",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["nameplate", "label", "serial"],
    isPhoto: true,
    pePhotoNumber: 3,
  },
  {
    id: "m1.photos.4_electrical",
    label: "Wide-angle all electrical",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["electrical", "equipment", "indoor", "outdoor"],
    isPhoto: true,
    pePhotoNumber: 4,
  },
  {
    id: "m1.photos.5_msp",
    label: "Main service panel (cover off)",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["msp", "panel", "breaker", "service_panel"],
    isPhoto: true,
    pePhotoNumber: 5,
  },
  {
    id: "m1.photos.6_invoice_bom",
    label: "Invoice & BOM",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5", "0"],
    searchAllFolders: false,
    fileHints: ["invoice", "bom", "bill_of_materials"],
    isPhoto: true,
    pePhotoNumber: 6,
  },
  {
    id: "m1.photos.7_inverter",
    label: "Inverter/micro/optimizer model",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["inverter", "microinverter", "optimizer", "enphase", "solaredge"],
    isPhoto: true,
    pePhotoNumber: 7,
  },
  {
    id: "m1.photos.8_racking",
    label: "Racking parts + markings",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["racking", "rail", "ironridge", "unirac", "clamp"],
    isPhoto: true,
    pePhotoNumber: 8,
  },
  {
    id: "m1.photos.9_storage_wide",
    label: "Storage wide angle",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["battery", "storage", "powerwall", "encharge"],
    isPhoto: true,
    pePhotoNumber: 9,
  },
  {
    id: "m1.photos.10_storage_nameplate",
    label: "Storage nameplate & labels",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["battery_label", "storage_nameplate", "battery_serial"],
    isPhoto: true,
    pePhotoNumber: 10,
  },
  {
    id: "m1.photos.11_storage_controller",
    label: "Storage controller/disconnect",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["controller", "gateway", "disconnect", "battery_disconnect"],
    isPhoto: true,
    pePhotoNumber: 11,
  },

  // --- Admin ---
  {
    id: "m1.admin.commissioning",
    label: "Commissioning Proof",
    category: "admin",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5", "8"],
    searchAllFolders: false,
    fileHints: ["commissioning", "monitoring", "site_id", "enphase", "solaredge", "tesla_app"],
    isPhoto: false,
  },
  {
    id: "m1.admin.hoa",
    label: "HOA Approval (if applicable)",
    category: "admin",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: true,
    fileHints: ["hoa", "homeowner association"],
    isPhoto: false,
  },

  // --- Post-Install ---
  {
    id: "m1.post_install.attestation",
    label: "Installer Attestation (Exhibit A)",
    category: "post_install",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["attestation", "exhibit_a", "installer_attestation"],
    isPhoto: false,
  },
  {
    id: "m1.post_install.acceptance",
    label: "Customer Acceptance Certificate (Exhibit B)",
    category: "post_install",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["acceptance", "exhibit_b", "customer_acceptance", "certificate_of_acceptance"],
    isPhoto: false,
  },

  // --- Inspection ---
  {
    id: "m1.inspection.ahj_permit",
    label: "AHJ Signed Final Permit",
    category: "inspection",
    milestone: "m1",
    appliesTo: ALL,
    // Canonically the signed inspection card belongs in "6. Inspections",
    // but Photon ops sometimes files it under "3. Permitting" (especially
    // for AHJs that issue a combined permit+inspection card document).
    // Verified 2026-05-18 against Brownell — Jefferson County issues a
    // "Post Inspection Card" that ops filed in folder 3 unsigned, then
    // the same card gets stamped post-inspection and re-uploaded.
    // Vision verification still rejects unsigned/un-passed cards, so the
    // extra folder doesn't create false positives.
    driveFolders: ["6", "3"],
    searchAllFolders: false,
    fileHints: ["inspection", "permit", "inspection_card", "final_inspection", "passed"],
    isPhoto: false,
  },

  // --- Lien ---
  {
    id: "m1.lien.conditional",
    label: "Conditional Progress Lien Waiver",
    category: "lien",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["conditional_waiver", "progress_waiver", "conditional_lien"],
    isPhoto: false,
  },

  // --- FEOC Compliance (PE Policy 01 §3) ---
  {
    id: "m1.compliance.feoc",
    label: "FEOC Compliance",
    category: "compliance",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0", "8"],
    searchAllFolders: true,
    fileHints: ["feoc", "foreign_entity", "domestic_content", "compliance", "safe_harbor"],
    isPhoto: false,
  },
];
