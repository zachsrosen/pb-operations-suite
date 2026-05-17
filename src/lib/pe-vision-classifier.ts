import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import type { ChecklistItem } from "@/lib/pe-turnover";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionClassification {
  matchedChecklistIds: string[];
  confidence: "high" | "medium" | "low";
  documentType: string;
  issues: string[];
  signatures: { present: boolean; count: number; allSigned: boolean };
  dateRelevance?: { date: string; isExpired: boolean; expiresIn?: number };
  equipmentFound?: string[];
}

export interface PhotoVerification {
  matchedChecklistId: string;
  requirement: string;
  verdict: "pass" | "fail" | "needs_review";
  issues: string[];
  equipmentVisible: string[];
  confidence: "high" | "medium" | "low";
}

export interface EnrichedVisionResult {
  status: "pass" | "fail" | "needs_review";
  notes: string;
  confidence: "high" | "medium" | "low";
  issues: string[];
  signatures?: { present: boolean; count: number; allSigned: boolean };
  dateRelevance?: { date: string; isExpired: boolean; expiresIn?: number };
  equipmentVisible?: string[];
  pmOverride?: { overriddenAt: string; originalVerdict: string };
}

export type VisionFileInput = {
  fileId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  /** Pre-uploaded Anthropic Files API ID — if set, skips redundant re-upload. */
  anthropicFileId?: string;
};

export type VisionResult =
  | { kind: "document"; classification: VisionClassification }
  | { kind: "photo"; verification: PhotoVerification }
  | { kind: "error"; error: string };

export interface ClassifyOptions {
  referenceFileId?: string;
  referenceMimeType?: string;
  avlContext?: string;
}

// ---------------------------------------------------------------------------
// Document descriptions — tells the classifier what each item actually IS
// so it can distinguish similar-looking documents (e.g. proposal vs agreement)
// ---------------------------------------------------------------------------

const PE_DOCUMENT_DESCRIPTIONS: Record<string, string> = {
  // --- Contract & Proposal ---
  "m1.contract.customer_agreement":
    "The formal PPA/ESA/Lease contract between customer and installer. " +
    "Countersigned by both parties. Filename usually starts with PE_CON_ or contains 'contract_package'. " +
    "Often a multi-page contract package that ALSO contains the Installation Order and Disclosures. " +
    "This is NOT the sales proposal/quote — it is the binding legal agreement.",
  "m1.contract.installation_order":
    "The installation order (IO) — a work authorization addendum to the Customer Agreement. " +
    "Lists equipment, system size, and installation scope. Often combined in the same PDF as the Customer Agreement. " +
    "NOT a standalone sales proposal or quote.",
  "m1.contract.disclosures":
    "State-required disclosures (e.g. CO consumer protection, CA CSLB disclosures). " +
    "Signed or initialed by customer. Often combined in the same PDF as the Customer Agreement. " +
    "NOT a standalone contract or proposal.",
  "m1.contract.proposal":
    "The sales proposal or quote document showing system design, pricing, equipment, and savings estimates. " +
    "Must be generated from a PE-approved simulation tool: Aurora, Energy Toolbase, Solargraf, OpenSolar, Solo, or Artemis (PE Policy 08). " +
    "Filename usually starts with 'Proposal' or contains 'quote'. Signed or digitally acknowledged by the customer. " +
    "This is NOT the binding Customer Agreement/contract — it is a pre-sale quote/proposal. " +
    "Must include: system size (kW), equipment list, pricing, expected performance/output, and expected utility bill impact. " +
    "If Year 1 production exceeds 135% of annual load, a Load Justification Form is required.",
  "m1.contract.utility_bill":
    "A utility bill showing the customer's electricity usage. Must be dated within the last 3 months. " +
    "Should show 12 months of usage history if available. " +
    "From the local electric utility (Xcel Energy, PG&E, SCE, SDG&E, etc.). " +
    "NOT a proposal, contract, or invoice.",
  "m1.contract.loan_docs":
    "Loan or financing documents from a third-party lender. " +
    "PE-approved lenders: Credit Human, Honolulu Credit Union, Wheelhouse Credit Union (PE Policy 10). " +
    "Flag if lender is not on this approved list. NOT a solar proposal or contract.",
  "m1.contract.incentive_forms":
    "Incentive application forms (3CE, Xcel rebate, state incentive). " +
    "NOT a utility bill, proposal, or contract.",

  // --- Design ---
  "m1.design.planset":
    "The final engineering plan set / design package. " +
    "Multi-page technical drawings that MUST include: site plan showing panel layout on roof, " +
    "electrical single-line diagram showing inverter/panel/meter connections, structural attachment details, " +
    "and an equipment schedule listing specific module brand/model/wattage, inverter brand/model, and racking type. " +
    "PE will reject incomplete plan sets — all four sections (site plan, single-line, structural, equipment schedule) must be present. " +
    "NOT a proposal, contract, or inspection card.",

  // --- Admin ---
  "m1.admin.commissioning":
    "Screenshot or PDF proving the monitoring system is ONLINE and the System Owner (PE) has access. " +
    "Must show the EQUIPMENT/SYSTEM OVERVIEW page from the monitoring platform — NOT just any dashboard page. " +
    "PE Policy 01 requires: revenue grade meter (RGM) installed, cell kits for ALL projects, home load metering. " +
    "Monitoring site ID must be visible. System Owner (PE) must have site access (site owner designation). " +
    "For Tesla PowerHub: must be the Equipment or System Overview page showing installed hardware (Powerwall model, gateway, solar inverter). " +
    "A generic energy graph or dashboard without equipment details is NOT sufficient. " +
    "For Enphase Enlighten: must show system overview with microinverter details. " +
    "For SolarEdge: must show system dashboard with inverter/optimizer details. " +
    "Must show the system is ONLINE and producing power (production data or live status visible). " +
    "Address shown must match the contract. A login page alone is NOT sufficient. " +
    "NOT a nameplate photo, invoice, equipment spec sheet, or installation manual.",
  "m1.admin.hoa":
    "HOA (Homeowners Association) approval letter for the solar installation. " +
    "NOT a permit, inspection card, or contract.",

  // --- Post-Install ---
  "m1.post_install.attestation":
    "Exhibit A — Installer Attestation of Customer Payment. " +
    "A PE-specific template document confirming the customer has paid all amounts owed. " +
    "Generated via PandaDoc. Title contains 'Installer Attestation' or 'Exhibit A'. " +
    "NOT a contract, proposal, or lien waiver.",
  "m1.post_install.acceptance":
    "Exhibit B — Customer Certificate of Acceptance. " +
    "A PE-specific template document where the customer certifies the installation is satisfactory. " +
    "Generated via PandaDoc. Title contains 'Certificate of Acceptance' or 'Exhibit B'. " +
    "NOT a contract, proposal, or attestation.",

  // --- Inspection ---
  "m1.inspection.ahj_permit":
    "The AHJ (Authority Having Jurisdiction) signed final inspection card/permit. " +
    "Proves the local building department inspected and passed the installation. " +
    "Usually a scanned inspection card with inspector's signature and 'PASSED'/'APPROVED' stamp. " +
    "NOT a building permit application — this is the SIGNED/APPROVED result.",

  // --- Lien ---
  "m1.lien.conditional":
    "Conditional Progress Lien Waiver — a statutory lien waiver form for progress payment. " +
    "State-specific legal form. Title contains 'Conditional Waiver', 'Progress Waiver', or 'Lien Waiver'. " +
    "NOT an attestation, acceptance certificate, or contract.",

  // --- FEOC Compliance ---
  "m1.compliance.feoc":
    "FEOC (Foreign Entity of Concern) compliance documentation. " +
    "For projects with 2026+ PTO, equipment must comply with FEOC rules per PE Policy 01. " +
    "May be a Safe Harbor certificate, domestic content attestation, or FEOC compliance letter. " +
    "Verifies that no critical components are from a Prohibited Foreign Entity (PFE). " +
    "NOT a contract, proposal, or standard equipment warranty.",

  // --- M2 ---
  "m2.pto.pto_letter":
    "The official Permission to Operate (PTO) letter from the utility company. " +
    "Authorizes the solar system to connect to the grid and export power. " +
    "Often a forwarded email PDF from the utility. Contains 'Permission to Operate' or 'PTO'. " +
    "NOT an interconnection agreement, permit, or inspection card.",
  "m2.pto.interconnection":
    "The signed Interconnection Agreement (IA) between the utility and customer/installer. " +
    "Governs how the solar system connects to the utility grid. Both parties must sign. " +
    "May be titled 'DER Interconnection Agreement', 'Net Metering Agreement', or 'Renewable Battery Connect Agreement'. " +
    "NOT the PTO letter — this is a separate agreement document.",
  "m2.warranty.assignment":
    "Warranty registration or assignment documentation proving equipment warranties are activated. " +
    "NOT a proposal, contract, or PTO letter.",
  "m2.incentives.documentation":
    "Incentive approval letters or rebate documentation from PE or utility programs. " +
    "NOT a utility bill, contract, or warranty document.",
  "m2.lien.final":
    "Conditional Waiver and Release on Final Payment — the final payment lien waiver. " +
    "State-specific statutory form. Title contains 'Final Payment', 'Final Waiver', or 'Unconditional Waiver'. " +
    "NOT the progress/conditional waiver (that's M1) — this is for FINAL payment.",
};

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildDocumentPrompt(
  checklistItems: ChecklistItem[],
  options?: { hasReference?: boolean; avlContext?: string; candidateFileName?: string },
): string {
  const itemList = checklistItems
    .filter((i) => !i.isPhoto)
    .map((i) => {
      const desc = PE_DOCUMENT_DESCRIPTIONS[i.id];
      return desc
        ? `- ${i.id}: ${i.label}\n  ${desc}`
        : `- ${i.id}: ${i.label} (category: ${i.category})`;
    })
    .join("\n");

  const sections: string[] = [
    `You are a document verification system for Participate Energy (PE) milestone submissions in the solar industry.
Your job is to CLASSIFY this document AND deeply verify it meets PE's quality standards.
Be CONSERVATIVE — only match a checklist ID if the document genuinely IS that type. When in doubt, return an empty matchedChecklistIds array rather than a wrong match.`,
  ];

  if (options?.candidateFileName) {
    sections.push(`## Candidate File
Filename: ${options.candidateFileName}
Use the filename as a classification signal — but always verify against the actual document content.`);
  }

  if (options?.hasReference) {
    sections.push(`## Reference Example
The first file attached is an APPROVED example from a previously paid PE submission.
Use it as a baseline for quality, format, and completeness when evaluating the candidate document (the second file).`);
  }

  sections.push(`## PE Checklist Items (documents only)
${itemList}`);

  if (options?.avlContext) {
    sections.push(`## Equipment Approved Vendor List (AVL) & FEOC Compliance
If you can identify equipment brand/model/SKU in this document, cross-check against PE's AVL.
Flag any equipment NOT on this list as an "avl_mismatch" issue.

PE Policy 01 requires FEOC (Foreign Entity of Concern) compliance for all projects with 2026+ PTO.
Equipment must not be manufactured by or contain critical components from a Prohibited Foreign Entity (PFE).
Solar and Battery systems must independently meet Domestic Content thresholds (50% for 2026 construction start).

Key AVL brands: BESS: Tesla PW3, Enphase IQ Battery, SolarEdge, Qcells, Generac | Modules: REC, Hyundai, Qcells, Silfab, Tesla | Inverters: SolarEdge HomeHub, Enphase IQ8/IQ9, Tesla, Generac | Racking: IronRidge, SnapNrack, Unirac, Pegasus, K2

${options.avlContext}`);
  }

  sections.push(`## PE-Specific Verification Requirements (from PE Policies 01, 04, 06, 08)

**CROSS-REFERENCING (applies to ALL documents):**
PE validates that customer name, property address, system size, and equipment match ACROSS all documents in the package. When verifying any document, extract and report: customer name, property address, system size (kW DC), and all equipment brand/model so the PM can cross-reference.

**For Plan Sets (m1.design.planset):**
- Must contain ALL four sections: site plan, electrical single-line diagram, structural details, equipment schedule
- Equipment schedule must list SPECIFIC module brand/model/wattage, inverter brand/model, battery brand/model if applicable
- Extract and report ALL equipment with FULL model numbers including variant codes:
  - Modules: brand + model + wattage + quantity (e.g., "REC Alpha Pure-R 430W × 24")
  - Inverter: brand + full model (e.g., "Enphase IQ8PLUS-72-2-US")
  - Battery/storage: brand + FULL model number with variant code (e.g., "Tesla Powerwall 3 1707000-21-Y")
- CRITICAL for Tesla Powerwall 3: extract the EXACT part number from the electrical line diagram. Flag if it shows:
  - "1707000-XX-Y" — this is a PLACEHOLDER, not a real model number. PE will reject.
  - "1707000-11-J" or "1707000-11-M" — these are WRONG variants (old/recalled). PE requires "1707000-21-Y" (or similar 21-series).
  - Any model containing "XX" is a placeholder that needs revision.
- System size and components must match the Customer Agreement and Installation Order
- Flag if plan set is incomplete (missing single-line diagram, missing equipment schedule, missing structural details)

**For Proposals (m1.contract.proposal):**
- Must be generated from an approved simulation tool (Aurora, Energy Toolbase, Solargraf, OpenSolar, Solo, or Artemis — per PE Policy 08)
- Must show: system size (kW DC), equipment list, pricing, expected performance/capacity/output, expected utility bill impact
- If estimated annual Year 1 production exceeds 135% of historical annual load, a Load Justification Form is required (PE Policy 08)
- Extract equipment listed: module brand/model/qty, inverter brand/model/qty, battery brand/model if applicable
- Flag if unsigned or missing customer acknowledgment
- Customer name and address must match the contract

**For Utility Bills (m1.contract.utility_bill):**
- Bill date must be within 3 MONTHS of today (${new Date().toISOString().slice(0, 10)}) — PE Policy 06 requires "dated within the last three months"
- Should show 12 months of usage history if available
- Customer name and service address must be visible and match the Customer Agreement
- Flag if bill is older than 3 months, if usage data is obscured, or if customer name/address is not visible or doesn't match the contract

**For Loan Documents (m1.contract.loan_docs):**
- If financing is through a lender, the lender must be on PE's Approved Lender List: Credit Human, Honolulu Credit Union, or Wheelhouse Credit Union (PE Policy 10)
- Flag if lender name is not on the approved list

**For Commissioning/Monitoring Proof (m1.admin.commissioning):**
- Must be a screenshot of the monitoring platform showing the system/equipment overview page
- PE Policy 01 requires: revenue grade meter (RGM) installed, cell kits for ALL projects, home load consumption metering, system properly registered with OEM
- Monitoring site ID must be visible in the screenshot
- System Owner (PE) must have site access (site owner designation) — flag if screenshot doesn't show PE/System Owner access
- For Tesla PowerHub: must show the EQUIPMENT or SYSTEM OVERVIEW page — NOT just any PowerHub page. Must show installed hardware (Powerwall model, gateway, solar inverter) and system status. A generic dashboard or energy graph alone is NOT sufficient.
- For Enphase Enlighten: must show system overview with microinverter details visible
- For SolarEdge: must show system dashboard with inverter/optimizer details
- Must show the system is ONLINE and producing power (production data or live status visible)
- Address shown in monitoring must match the contract address
- Flag if: just a login page, generic energy graph without equipment details, spec sheet, or no site ID visible

**For Invoice/BOM (seen as Photo 6 but also applies to documents):**
- Must show the customer's name matching the deal/contract
- Must list ALL major equipment with specific models and quantities:
  - Solar modules (brand, model, wattage, qty)
  - Inverter(s) (brand, model, qty)
  - Battery/storage (brand, full model with variant code, qty) — for Tesla PW3: must show "1707000-21-Y" not "XX-Y" or "11-J"
  - Backup switch, sub panels, and electrical components if applicable
- Equipment listed must include domestic content part numbers that correspond with PE's AVL
- Parts on invoice must correspond with what is shown in installation photos
- Flag if major equipment categories are missing (e.g., has PW3 but no backup switch, or has modules but no inverter)

**For AHJ Permits (m1.inspection.ahj_permit):**
- Must show inspector signature AND date (both required)
- Must be the FINAL inspection (not a rough/framing inspection)
- Homeowner name on permit must match the Customer Agreement
- Property address on permit must match the Customer Agreement
- Flag if unsigned, undated, if it's an application (not result), or if inspection type is not "final"

**For Contracts (customer_agreement, installation_order, disclosures):**
- Customer Agreement must be initialed AND fully signed by both parties (customer + installer/dealer)
- Installation Order must show system size and components that match other documents (plan set, proposal)
- Customer name and property address must be visible and consistent across CA, IO, and Disclosures
- State-required disclosures must be signed/initialed by the customer
- Flag any missing signatures, missing initials, or blank signature fields

**For Installer Attestation (m1.post_install.attestation) / Exhibit A:**
- Must be signed by installer representative
- Customer name and address must match the contract

**For Customer Certificate of Acceptance (m1.post_install.acceptance) / Exhibit B:**
- Must be signed by the customer
- Customer name and address must match the contract

**For Lien Waivers:**
- Progress/Conditional Lien Waiver (m1.lien.conditional): amount should correspond to installation package fees
- Final Lien Waiver (m2.lien.final): amount should correspond to interconnection package fees
- Both must be properly signed

**For PTO Letters (m2.pto.pto_letter):**
- Must explicitly authorize the system to operate and export power
- Must be from the utility company (not from the installer)
- Must contain BOTH: a date within the letter body AND an issuance date
- Homeowner name must match the Customer Agreement
- Property address must match the Customer Agreement
- Flag if it's an application or acknowledgment rather than actual permission to operate

**For Interconnection Agreements (m2.pto.interconnection):**
- Must be signed by both utility and customer/installer
- Customer name and address must match the Customer Agreement
- Flag if only one party has signed`);

  const instructions = [
    "1. Identify what type of document this is (contract, proposal, utility bill, permit, lien waiver, etc.)",
    "2. Match it to one or more checklist IDs from the list above. A single PDF may contain multiple documents (e.g. a contract package containing Customer Agreement + Installation Order + Disclosures).",
    "3. CRITICAL: Do NOT confuse similar-sounding documents. A sales PROPOSAL (pricing/design quote) is NOT a Customer AGREEMENT (binding contract). An inspection CARD is NOT a building PERMIT application. A PTO LETTER is NOT an Interconnection AGREEMENT.",
    "4. If the document doesn't clearly match any checklist item, return an EMPTY matchedChecklistIds array. A wrong match is worse than no match.",
    "5. Check for signatures — are they present? How many? Are all required signature fields signed?",
    "6. Check for date relevance — utility bills must be within 3 MONTHS (PE Policy 06), permits should not be expired.",
    "7. Apply the PE-specific verification requirements above for the matched document type.",
    "8. Extract any visible equipment info (brand, model, wattage/capacity) into the equipmentFound field.",
    "9. Flag ALL issues — PE reviewers will reject submissions for: missing signatures, expired dates, incomplete plan sets, illegible text, wrong document types, name/address mismatches, and missing equipment details.",
  ];
  if (options?.avlContext) {
    instructions.push("10. If equipment is identifiable, verify it appears on the AVL. Flag mismatches.");
  }
  sections.push(`## Instructions\n${instructions.join("\n")}`);

  sections.push(`## Response Format (JSON only, no markdown)
{
  "matchedChecklistIds": ["m1.contract.customer_agreement"] or [] if no match,
  "confidence": "high" | "medium" | "low",
  "documentType": "Customer Agreement",
  "issues": ["Missing signature on page 2", "Customer address not visible"],
  "signatures": { "present": true, "count": 2, "allSigned": false },
  "dateRelevance": { "date": "2025-11-15", "isExpired": false, "expiresIn": 180 } or null,
  "equipmentFound": ["REC Alpha Pure-R 430W", "Enphase IQ8+"] or []
}`);

  return sections.join("\n\n");
}

function buildPhotoPrompt(
  item: ChecklistItem,
  options?: { hasReference?: boolean },
): string {
  const photoReqs: Record<number, { description: string; passReqs: string; failReqs: string }> = {
    1: {
      description: "Site address visible on the home or mailbox, showing the full front of the house",
      passReqs: "Street number clearly legible, house/building fully visible in frame, address matches the deal/contract",
      failReqs: "Address not readable, only partial house shown, wrong location, photo taken too far away to read numbers",
    },
    2: {
      description: "Wide-angle photo of the ENTIRE installed PV (solar panel) array on the roof",
      passReqs: "ENTIRE array visible in frame from sufficient distance, all panels accounted for, shows full roof coverage",
      failReqs: "Array cut off at edges, only partial array visible, too close (just a few panels), taken from inside attic",
    },
    3: {
      description: "Close-up of a solar module nameplate label — brand, model, serial number, wattage, country of origin, and certifications must be LEGIBLE",
      passReqs: "Brand name readable, model number readable, serial number readable, wattage readable, country of origin visible, certification labels visible (UL, IEC, etc.). Report exact values for all.",
      failReqs: "Label blurry or illegible, too far away, glare obscures text, label partially covered, country of origin not visible",
    },
    4: {
      description: "Wide-angle photo showing ALL electrical equipment in a single frame (inverter, disconnect, meter, conduit runs)",
      passReqs: "Inverter visible, AC disconnect visible, production meter visible (if applicable), conduit runs between equipment visible — all in one frame. NEC-compliant installation visible.",
      failReqs: "Only one component shown, major equipment out of frame, too close for full view, multiple separate photos instead of one wide shot",
    },
    5: {
      description: "Main service panel (MSP/breaker panel) with the dead-front cover REMOVED, showing breakers and wiring",
      passReqs: "Panel OPEN with dead-front cover removed, individual breakers visible, wiring visible, solar/backfeed breaker identifiable, NEC-compliant wiring",
      failReqs: "Panel cover still ON (only exterior visible), panel door closed, shows sub-panel not MSP. This is the #1 PE rejection reason.",
    },
    6: {
      description: "Invoice or Bill of Materials (BOM) document showing ALL equipment purchased with domestic content part numbers from PE's AVL",
      passReqs: "Invoice/BOM visible, customer name readable, ALL equipment line items readable with brand, FULL model numbers (including variant codes), quantity. Must include: modules, inverter(s), battery/storage with full part number (e.g. Tesla 1707000-21-Y), backup switch, sub panels if applicable. Domestic content part numbers should correspond to PE's Approved Vendor List. Parts listed must correspond with what is shown in installation photos.",
      failReqs: "Spreadsheet screenshot with no vendor, text illegible, proposal not invoice, customer name missing. NEEDS_REVIEW if major equipment categories appear missing or if part numbers don't match AVL format",
    },
    7: {
      description: "Inverter/microinverter/optimizer nameplate label — brand, model, serial number, and electrical ratings must be LEGIBLE",
      passReqs: "Brand readable, model number readable, serial readable, electrical ratings visible (voltage, current, power). Report exact values. For microinverters, at least one unit label must be fully legible.",
      failReqs: "Label blurry/illegible, too far away, glare/shadow obscures label, cannot read brand AND model",
    },
    8: {
      description: "Racking parts — TWO things required: (1) packaging/box labels showing brand and part numbers, AND (2) markings on individual installed parts (rails, clamps, flashings)",
      passReqs: "BOTH visible: racking packaging/box with brand label and part numbers readable, AND markings on installed rails/clamps/flashings showing brand identification. Report brand (IronRidge, Unirac, SnapNrack, Pegasus, K2, etc.) and any part numbers visible.",
      failReqs: "Only packaging OR only installed parts shown (need both), no markings visible, generic metal with no identification, part numbers not readable",
    },
    9: {
      description: "Wide-angle photo of the energy storage (battery) system installation showing full system and mounting context",
      passReqs: "Full battery system visible including wall mounting, associated electrical equipment visible (gateway, disconnect), installation context clear (conduit runs, wiring)",
      failReqs: "Battery partially cut off in frame, photo too close to see full installation, battery not the main subject of photo",
    },
    10: {
      description: "Battery/storage nameplate label for EACH storage unit — brand, model, serial number, capacity, and country of origin must be LEGIBLE",
      passReqs: "For EACH storage unit: brand readable, FULL model/part number readable (including variant code), serial number readable, capacity (kWh) readable, country of origin visible. For Tesla PW3: extract full part number (e.g. 1707000-21-Y). CRITICAL: flag '1707000-11-M' or '1707000-11-J' as WRONG variant — PE requires 21-series (1707000-21-Y, 21-M, 21-K, etc.). Flag 'LEADER' sticker (associated with recalled 11-M units). If multiple units, each needs a photo.",
      failReqs: "Label blurry, illegible, too far away, partially obstructed, obscured by conduit, country of origin not visible, only one unit shown when multiple installed",
    },
    11: {
      description: "Storage controller, gateway, or disconnect switch — serial number must be visible, wiring must be shown in a single clear shot",
      passReqs: "Gateway/controller device visible and identifiable, brand/model readable, serial number visible, associated wiring/conduit shown in the same frame. For Tesla: Tesla Gateway or Backup Switch visible.",
      failReqs: "Device not identifiable, no labels/serial readable, wiring not visible in same shot, wrong equipment shown, serial number obscured",
    },
  };

  const req = photoReqs[item.pePhotoNumber ?? 0];
  const description = req?.description ?? item.label;

  const referenceNote = options?.hasReference
    ? `\n## Reference Photo
The first image is an APPROVED example of this photo type from a previously paid PE submission.
Compare the candidate photo (the second image) against it for expected content, quality, and angle.\n`
    : "";

  return `You are a photo verification system for Participate Energy (PE) milestone submissions.

## PE Photo Requirement
Photo ${item.pePhotoNumber}: ${item.label}
Description: ${description}
${req ? `\n**PASS requires:** ${req.passReqs}\n**FAIL if:** ${req.failReqs}` : ""}
${referenceNote}
## Instructions
1. Does this image satisfy the PE photo requirement above? Apply the PASS/FAIL criteria strictly.
2. Is the image clear and well-lit enough for PE review?
3. List ALL visible equipment — brand names, model numbers, serial numbers, specs (wattage, kWh, amps).
4. For nameplate/label photos: if you cannot read the brand AND model number, verdict must be "fail" or "needs_review".
5. For wide-angle photos: if major equipment is cut off or out of frame, verdict must be "fail".
6. For MSP (Photo 5): if the panel dead-front cover is still ON, verdict MUST be "fail".
7. Be SPECIFIC in issues — not "blurry" but "Module nameplate label blurry — brand readable (REC) but model and serial not legible".

## Response Format (JSON only, no markdown)
{
  "matchedChecklistId": "${item.id}",
  "requirement": "${description}",
  "verdict": "pass" | "fail" | "needs_review",
  "issues": ["Specific actionable issue for the PM"],
  "equipmentVisible": ["REC Alpha Pure-R 430W (S/N: ABC123)", "Enphase IQ8PLUS-72-2-US"],
  "confidence": "high" | "medium" | "low"
}`;
}

// ---------------------------------------------------------------------------
// Post-processing — mutual exclusion rules
// ---------------------------------------------------------------------------

/** IDs that indicate a contract package (CA + IO + Disclosures combined PDF). */
const CONTRACT_PACKAGE_IDS = new Set([
  "m1.contract.customer_agreement",
  "m1.contract.installation_order",
  "m1.contract.disclosures",
]);

/**
 * Sanitize matchedChecklistIds to remove known false positives.
 * A contract package (containing CA/IO/Disclosures) is NOT a standalone
 * sales proposal — if both are present, drop the proposal match.
 */
function sanitizeMatchedIds(ids: string[]): string[] {
  const hasContractPackage = ids.some((id) => CONTRACT_PACKAGE_IDS.has(id));
  if (hasContractPackage) {
    return ids.filter((id) => id !== "m1.contract.proposal");
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Classification functions
// ---------------------------------------------------------------------------

export async function uploadToAnthropic(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  const client = getAnthropicClient();
  const file = await client.beta.files.upload({
    file: new File([new Uint8Array(buffer)], fileName, { type: mimeType }),
  });
  return file.id;
}

export async function classifyDocument(
  input: VisionFileInput,
  checklistItems: ChecklistItem[],
  options?: ClassifyOptions,
): Promise<VisionResult> {
  try {
    const client = getAnthropicClient();
    const fileId = input.anthropicFileId ?? await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
    const prompt = buildDocumentPrompt(checklistItems, {
      hasReference: !!options?.referenceFileId,
      avlContext: options?.avlContext,
      candidateFileName: input.fileName,
    });

    const contentType = input.mimeType.startsWith("image/") ? "image" as const : "document" as const;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentBlocks: any[] = [];
    if (options?.referenceFileId) {
      const refType = options.referenceMimeType?.startsWith("image/") ? "image" : "document";
      contentBlocks.push({ type: refType, source: { type: "file", file_id: options.referenceFileId } });
    }
    contentBlocks.push({ type: contentType, source: { type: "file", file_id: fileId } });
    contentBlocks.push({ type: "text", text: prompt });

    const message = await client.beta.messages.create({
      // Haiku is 3-4x faster than Sonnet on this structured-classification
      // task and the JSON output spec is identical. Sonnet remains for the
      // multi-image photo triage where category disambiguation across 20
      // similar photos benefits from the larger model.
      model: CLAUDE_MODELS.haiku,
      // 1500 covers the JSON response (matchedChecklistIds + issues + equipment).
      // Higher caps just leave latency on the table — Claude streams to max.
      max_tokens: 1500,
      messages: [{ role: "user", content: contentBlocks }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as VisionClassification;

    // Apply mutual exclusion rules (e.g. contract package ≠ proposal)
    parsed.matchedChecklistIds = sanitizeMatchedIds(parsed.matchedChecklistIds);

    return { kind: "document", classification: parsed };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifyPhoto(
  input: VisionFileInput,
  checklistItem: ChecklistItem,
  options?: Pick<ClassifyOptions, "referenceFileId" | "referenceMimeType">,
): Promise<VisionResult> {
  try {
    const client = getAnthropicClient();
    const fileId = input.anthropicFileId ?? await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
    const prompt = buildPhotoPrompt(checklistItem, { hasReference: !!options?.referenceFileId });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contentBlocks: any[] = [];
    if (options?.referenceFileId) {
      contentBlocks.push({ type: "image", source: { type: "file", file_id: options.referenceFileId } });
    }
    contentBlocks.push({ type: "image", source: { type: "file", file_id: fileId } });
    contentBlocks.push({ type: "text", text: prompt });

    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      max_tokens: 1500,
      messages: [{ role: "user", content: contentBlocks }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as PhotoVerification;

    return { kind: "photo", verification: parsed };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Batch photo triage — classify ALL photos in a single API call
// ---------------------------------------------------------------------------

export interface PhotoTriageResult {
  /** Map from photo index → best-matching checklist ID (or null if no match) */
  assignments: Map<number, { checklistId: string; verdict: "pass" | "fail" | "needs_review"; confidence: "high" | "medium" | "low"; issues: string[]; equipmentVisible: string[] }>;
}

/**
 * Classify a batch of photos against all PE photo checklist items in a single
 * Claude API call. Returns a mapping of photo index → matched checklist item.
 *
 * This replaces the O(items × candidates) individual verifyPhoto calls with
 * a single O(1) call, reducing 36+ API calls to 1.
 */
export async function triagePhotoBatch(
  photos: Array<{ anthropicFileId: string; fileName: string; driveFileId: string }>,
  photoItems: ChecklistItem[],
): Promise<PhotoTriageResult> {
  const result: PhotoTriageResult = { assignments: new Map() };
  if (photos.length === 0 || photoItems.length === 0) return result;

  const client = getAnthropicClient();

  const photoRequirements: Record<number, { description: string; peReqs: string }> = {
    1: {
      description: "Site address visible on the home or mailbox, showing the full front of the house",
      peReqs: "PASS requires: street number clearly legible, house/building fully visible, address matches deal. FAIL if: address not readable, only partial house shown, photo taken too far away to read numbers, or wrong house/location.",
    },
    2: {
      description: "Wide-angle photo of the ENTIRE installed PV (solar panel) array on the roof",
      peReqs: "PASS requires: ENTIRE array visible in frame from sufficient distance, full roof coverage shown. FAIL if: array cut off at edges, only partial array visible, too close (just a few panels), or taken from inside attic. NEEDS_REVIEW if: mostly visible but one edge slightly cut off.",
    },
    3: {
      description: "Close-up of solar module nameplate label — brand, model, serial, wattage, country of origin, and certifications must be LEGIBLE",
      peReqs: "PASS requires: brand readable, model readable, serial readable, wattage readable, country of origin visible, certification labels visible (UL, IEC). Report exact values. FAIL if: label blurry, text not legible, too far away, glare obscures text, label partially covered, or country of origin not visible.",
    },
    4: {
      description: "Wide-angle photo showing ALL electrical equipment in single frame (inverter, disconnect, meter, conduit runs)",
      peReqs: "PASS requires: inverter visible, AC disconnect visible, production meter visible (if applicable), conduit runs visible, all in one frame. FAIL if: only one component shown, major equipment out of frame, too close for full view, or multiple separate photos needed.",
    },
    5: {
      description: "Main service panel (MSP/breaker panel) with dead-front cover REMOVED showing breakers and wiring",
      peReqs: "PASS requires: panel OPEN with dead-front cover removed, breakers visible, wiring visible, solar/backfeed breaker identifiable. FAIL if: panel cover still ON (you can only see exterior), panel door closed, or shows sub-panel not MSP. This is the #1 PE rejection — cover MUST be off.",
    },
    6: {
      description: "Invoice/BOM showing ALL equipment purchased with domestic content part numbers from PE's AVL",
      peReqs: "PASS requires: actual invoice/BOM visible, customer name readable, ALL equipment line items with brand, FULL model/part numbers (including variant codes), quantity. Must include modules, inverter(s), battery/storage (full part number e.g. Tesla 1707000-21-Y not XX-Y), backup switch, sub panels. Domestic content part numbers should correspond to PE's AVL. Parts must correspond with install photos. FAIL if: text illegible, proposal not invoice, customer name missing. NEEDS_REVIEW if: major categories missing (battery but no backup switch, modules but no inverter).",
    },
    7: {
      description: "Inverter/microinverter/optimizer nameplate label — brand, model, serial, ratings must be LEGIBLE",
      peReqs: "PASS requires: brand readable, model readable, serial readable, electrical ratings visible (voltage, current, power). Report exact brand and model. FAIL if: blurry/illegible, cannot read text, too far away, glare/shadow obscures label. For microinverters, at least one unit label must be fully legible.",
    },
    8: {
      description: "Racking parts — BOTH packaging/box labels AND markings on installed parts (rails, clamps, flashings) required",
      peReqs: "PASS requires: BOTH visible: (1) racking packaging/box with brand label and part numbers readable, AND (2) markings on installed rails/clamps/flashings with brand identification. Report brand (IronRidge, Unirac, SnapNrack, Pegasus, K2, etc.) and part numbers. FAIL if: only packaging OR only installed parts (need both), no markings visible, generic metal with no ID. NEEDS_REVIEW if: brand identifiable but part numbers not fully readable.",
    },
    9: {
      description: "Wide-angle photo of the energy storage (battery) system installation showing full system and mounting",
      peReqs: "PASS requires: full battery system visible with mounting, associated electrical equipment visible (gateway, disconnect), installation context clear (conduit, wiring). FAIL if: battery partially cut off, too close, battery not the main subject.",
    },
    10: {
      description: "Battery/storage nameplate label for EACH unit — brand, model, serial, capacity, country of origin must be LEGIBLE",
      peReqs: "PASS requires: for EACH storage unit: brand readable, FULL part number readable (with variant code), serial readable, capacity (kWh) readable, country of origin visible. For Tesla PW3: extract full part number (e.g. 1707000-21-Y). CRITICAL: flag '1707000-11-M' or '1707000-11-J' as WRONG variant — PE requires 21-series (21-Y, 21-M, 21-K). Flag 'LEADER' sticker (associated with recalled 11-M units). If multiple units installed, each needs a photo. FAIL if: blurry, illegible, too far, obscured, country of origin not visible, only one unit when multiple installed.",
    },
    11: {
      description: "Storage controller/gateway/disconnect — serial number visible, wiring in single clear shot",
      peReqs: "PASS requires: gateway/controller visible and identifiable, brand/model readable, serial number visible, associated wiring/conduit shown in same frame. For Tesla: Gateway or Backup Switch visible. FAIL if: device not identifiable, no labels/serial readable, wiring not in same shot, wrong equipment.",
    },
  };

  const categoryList = photoItems
    .map((item) => {
      const req = photoRequirements[item.pePhotoNumber ?? 0];
      const desc = req?.description ?? item.label;
      const peReqs = req?.peReqs ?? "";
      return `- ${item.id} (Photo ${item.pePhotoNumber}): ${desc}\n  PE Requirements: ${peReqs}`;
    })
    .join("\n");

  const prompt = `You are a photo verification system for Participate Energy (PE) milestone submissions.
Your job is to CLASSIFY each photo AND deeply verify it meets PE's specific quality standards for that photo type.

## Task
I'm showing you ${photos.length} installation photos. For each photo:
1. Determine which PE photo category it best matches (if any)
2. Verify it meets PE's quality requirements for that category
3. Extract any visible equipment information (brand, model, serial numbers)
4. Flag specific issues that would cause PE to REJECT this photo

## PE Photo Categories & Requirements
${categoryList}

## Classification Rules
- Each photo can match AT MOST one category
- Each category should have AT MOST one best photo match
- If a photo doesn't clearly match any category, skip it
- If multiple photos could match a category, pick the one that best satisfies PE requirements

## Verification Rules
- **verdict "pass"**: Photo clearly satisfies ALL PE requirements for its category
- **verdict "fail"**: Photo is fundamentally wrong (wrong subject, cover still on panel, completely illegible, wrong hardware variant, etc.)
- **verdict "needs_review"**: Photo partially meets requirements but has quality concerns (slightly blurry label, partially cut off, etc.)
- For nameplate/label photos (Photos 3, 7, 10): if you CANNOT read the brand and model number, it MUST fail or needs_review
- For wide-angle photos (Photos 2, 4, 9): if major equipment is cut off or out of frame, it MUST fail
- For MSP photo (Photo 5): if the panel cover is still ON, it MUST fail — this is the #1 PE rejection reason for photos
- For battery nameplate (Photo 10): extract the FULL Tesla Powerwall 3 part number. If it shows "1707000-11-M" or "1707000-11-J", flag as "WRONG PW3 VARIANT — PE requires 21-series (e.g., 1707000-21-Y)". If "LEADER" sticker visible, flag.
- For invoice/BOM (Photo 6): check for ALL major equipment categories. Flag if battery line item shows "1707000-XX-Y" (placeholder) or "11-J" variant.
- List ALL readable equipment in equipmentVisible: brand names, FULL model/part numbers (including variant codes like -21-Y), serial numbers, wattage/capacity specs

## Response Format (JSON only, no markdown)
{
  "assignments": [
    {
      "photoIndex": 0,
      "fileName": "IMG_1234.jpg",
      "matchedChecklistId": "m1.photos.1_site_address" | null,
      "verdict": "pass" | "fail" | "needs_review",
      "confidence": "high" | "medium" | "low",
      "issues": ["Specific issue description for PM to act on"],
      "equipmentVisible": ["Enphase IQ8PLUS-72-2-US (S/N: 123456)", "IronRidge XR100"]
    }
  ]
}

Return one entry per photo. Set matchedChecklistId to null if no category matches.
For issues, be SPECIFIC — not "blurry" but "Module nameplate label is blurry — brand readable (REC) but model number and serial are not legible".
For equipmentVisible, include everything you can read: brand, model, serial numbers, specs (wattage, kWh, amps).`;

  // Build content blocks: all photos + prompt
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [];
  for (let i = 0; i < photos.length; i++) {
    contentBlocks.push({
      type: "text",
      text: `--- Photo ${i} (${photos[i].fileName}) ---`,
    });
    contentBlocks.push({
      type: "image",
      source: { type: "file", file_id: photos[i].anthropicFileId },
    });
  }
  contentBlocks.push({ type: "text", text: prompt });

  try {
    const message = await client.beta.messages.create({
      model: CLAUDE_MODELS.sonnet,
      // 4000 covers ~20 photo verdicts (~150 tokens each) with margin. 8000 was
      // overkill and added latency (Claude streams to the cap).
      max_tokens: 4000,
      messages: [{ role: "user", content: contentBlocks }],
      betas: ["files-api-2025-04-14"],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as {
      assignments: Array<{
        photoIndex: number;
        matchedChecklistId: string | null;
        verdict: "pass" | "fail" | "needs_review";
        confidence: "high" | "medium" | "low";
        issues: string[];
        equipmentVisible: string[];
      }>;
    };

    for (const a of parsed.assignments) {
      if (a.matchedChecklistId) {
        result.assignments.set(a.photoIndex, {
          checklistId: a.matchedChecklistId,
          verdict: a.verdict,
          confidence: a.confidence,
          issues: a.issues ?? [],
          equipmentVisible: a.equipmentVisible ?? [],
        });
      }
    }
  } catch (err) {
    console.error(`[pe-triage] Batch photo triage failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Batch classification with concurrency control
// ---------------------------------------------------------------------------

export interface ClassifyBatchOptions {
  concurrency?: number;
  classifyOptions?: ClassifyOptions;
  onProgress?: (result: { fileName: string; result: VisionResult }) => void;
}

export async function classifyBatch(
  files: VisionFileInput[],
  checklistItems: ChecklistItem[],
  opts?: ClassifyBatchOptions,
): Promise<Map<string, VisionResult>> {
  const concurrency = opts?.concurrency ?? 5;
  const results = new Map<string, VisionResult>();
  const queue = [...files];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;

      const isPhoto = file.mimeType.startsWith("image/");
      let result: VisionResult;

      if (isPhoto) {
        result = await classifyDocument(file, checklistItems, opts?.classifyOptions);
      } else {
        result = await classifyDocument(file, checklistItems, opts?.classifyOptions);
      }

      results.set(file.fileId, result);
      opts?.onProgress?.({ fileName: file.fileName, result });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function visionResultToEnriched(result: VisionResult): EnrichedVisionResult | null {
  if (result.kind === "error") {
    return {
      status: "needs_review",
      notes: `Vision error: ${result.error}`,
      confidence: "low",
      issues: [result.error],
    };
  }

  if (result.kind === "document") {
    const c = result.classification;
    const hasIssues = c.issues.length > 0;
    const status: EnrichedVisionResult["status"] =
      c.confidence === "low" ? "needs_review" :
      hasIssues ? "needs_review" :
      "pass";

    const notesParts: string[] = [];
    if (hasIssues) notesParts.push(c.issues.join("; "));
    else notesParts.push(`Classified as ${c.documentType}`);
    if (c.equipmentFound && c.equipmentFound.length > 0) {
      notesParts.push(`Equipment: ${c.equipmentFound.join(", ")}`);
    }

    return {
      status,
      notes: notesParts.join(" | "),
      confidence: c.confidence,
      issues: c.issues,
      signatures: c.signatures,
      dateRelevance: c.dateRelevance,
      equipmentVisible: c.equipmentFound,
    };
  }

  if (result.kind === "photo") {
    const v = result.verification;
    return {
      status: v.verdict,
      notes: v.issues.length > 0 ? v.issues.join("; ") : "Photo verified",
      confidence: v.confidence,
      issues: v.issues,
      equipmentVisible: v.equipmentVisible,
    };
  }

  return null;
}
