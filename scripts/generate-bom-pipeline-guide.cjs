const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TabStopType, TabStopPosition,
} = require("docx");

// ── Theme colors ──────────────────────────────────────────────
const ORANGE = "E87722";
const DARK   = "1A1A2E";
const MID    = "3A3A5C";
const LIGHT  = "6B7280";
const BG     = "F8F9FA";
const WHITE  = "FFFFFF";
const GREEN  = "16A34A";
const BLUE   = "2563EB";
const RED    = "DC2626";
const AMBER  = "D97706";

// ── Helpers ───────────────────────────────────────────────────
const CONTENT_WIDTH = 9360; // US Letter - 1" margins

const border = { style: BorderStyle.SINGLE, size: 1, color: "D1D5DB" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorders = {
  top: { style: BorderStyle.NONE, size: 0 },
  bottom: { style: BorderStyle.NONE, size: 0 },
  left: { style: BorderStyle.NONE, size: 0 },
  right: { style: BorderStyle.NONE, size: 0 },
};
const cellPad = { top: 60, bottom: 60, left: 120, right: 120 };
const headerPad = { top: 80, bottom: 80, left: 120, right: 120 };

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function para(text, opts = {}) {
  const runs = typeof text === "string"
    ? [new TextRun({ text, ...opts })]
    : text;
  return new Paragraph({ children: runs, spacing: { after: 120 } });
}

function bold(text) {
  return new TextRun({ text, bold: true });
}

function mono(text) {
  return new TextRun({ text, font: "Courier New", size: 18, color: DARK });
}

function codePara(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: "Courier New", size: 17, color: MID })],
    spacing: { before: 40, after: 40 },
    indent: { left: 360 },
  });
}

function spacer(pts = 120) {
  return new Paragraph({ spacing: { after: pts }, children: [] });
}

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: DARK, type: ShadingType.CLEAR },
    margins: headerPad,
    verticalAlign: "center",
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, color: WHITE, font: "Arial", size: 19 })],
    })],
  });
}

function cell(content, width, opts = {}) {
  const children = typeof content === "string"
    ? [new Paragraph({ children: [new TextRun({ text: content, font: "Arial", size: 19, ...opts })] })]
    : Array.isArray(content) ? content : [content];
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: cellPad,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children,
  });
}

function table2(headers, rows, widths) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: headers.map((h, i) => headerCell(h, widths[i])) }),
      ...rows.map(r => new TableRow({
        children: r.map((c, i) => cell(c, widths[i])),
      })),
    ],
  });
}

function stageBox(number, title, bullets) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({
          borders: noBorders,
          width: { size: 700, type: WidthType.DXA },
          shading: { fill: ORANGE, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 80, right: 80 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(number), bold: true, color: WHITE, font: "Arial", size: 28 })],
          })],
        }),
        new TableCell({
          borders: noBorders,
          width: { size: 8660, type: WidthType.DXA },
          shading: { fill: BG, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 200, right: 120 },
          children: [
            new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: title, bold: true, font: "Arial", size: 24, color: DARK })],
            }),
            ...bullets.map(b => new Paragraph({
              numbering: { reference: "bullets", level: 0 },
              spacing: { after: 40 },
              children: typeof b === "string"
                ? [new TextRun({ text: b, font: "Arial", size: 19, color: MID })]
                : b,
            })),
          ],
        }),
      ],
    }),
  ];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [700, 8660],
    rows,
  });
}

function calloutBox(title, text, color = BLUE) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [new TableRow({
      children: [new TableCell({
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color },
          bottom: { style: BorderStyle.SINGLE, size: 1, color },
          left: { style: BorderStyle.SINGLE, size: 12, color },
          right: { style: BorderStyle.SINGLE, size: 1, color },
        },
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 200, right: 200 },
        children: [
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: title, bold: true, font: "Arial", size: 20, color })],
          }),
          new Paragraph({
            children: [new TextRun({ text, font: "Arial", size: 19, color: MID })],
          }),
        ],
      })],
    })],
  });
}

// ── Build document ────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: DARK },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: ORANGE },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: MID },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: "gotchas",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [
    // ── COVER PAGE ──────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        spacer(3600),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "BOM PIPELINE", font: "Arial", size: 56, bold: true, color: DARK })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "Developer Reference Guide", font: "Arial", size: 32, color: ORANGE })],
        }),
        spacer(200),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: ORANGE, space: 1 } },
          spacing: { before: 200 },
          children: [],
        }),
        spacer(200),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "PB Tech Ops Suite", font: "Arial", size: 24, color: LIGHT })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "Deal \u2192 Planset Extraction \u2192 Catalog Match \u2192 HubSpot Push \u2192 Zoho Sales Order", font: "Arial", size: 20, color: LIGHT })],
        }),
        spacer(1200),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Photon Brothers \u00B7 March 2026", font: "Arial", size: 20, color: LIGHT })],
        }),
      ],
    },

    // ── MAIN CONTENT ────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "BOM Pipeline Developer Guide", font: "Arial", size: 16, color: LIGHT }),
              new TextRun({ text: "\tPhoton Brothers", font: "Arial", size: 16, color: LIGHT }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ORANGE, space: 1 } },
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Confidential", font: "Arial", size: 16, color: LIGHT }),
              new TextRun({ text: "\tPage ", font: "Arial", size: 16, color: LIGHT }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: LIGHT }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: "D1D5DB", space: 1 } },
          })],
        }),
      },
      children: [
        // ── OVERVIEW ──────────────────────────────────────────
        heading("Overview"),
        para("The BOM (Bill of Materials) Pipeline automates the full path from a HubSpot deal to a Zoho Inventory Sales Order and Purchase Orders. It extracts equipment lists from planset PDFs using Claude AI, matches items to the product catalog, pushes line items to HubSpot, creates draft Sales Orders in Zoho, and optionally generates per-vendor Purchase Orders."),
        spacer(60),
        para([
          bold("Orchestrator: "),
          mono("src/lib/bom-pipeline.ts"),
        ]),
        spacer(120),

        // ── TRIGGERS ──────────────────────────────────────────
        heading("Pipeline Triggers"),
        para("The pipeline can be started three ways:"),
        spacer(60),
        table2(
          ["Trigger", "Source", "Details"],
          [
            ["Webhook", "HubSpot stage change", "Fires on design_complete or ready_to_build. Requires DESIGN_COMPLETE_AUTO_ENABLED=true"],
            ["Manual API", "UI or direct call", "POST /api/bom/extract, /push-to-hubspot, /create-so"],
            ["Retry", "Failed run recovery", "POST /api/bom/pipeline-retry for failed runs"],
          ],
          [1800, 2400, 5160],
        ),
        spacer(200),

        // ── PIPELINE STAGES ───────────────────────────────────
        heading("Pipeline Stages"),
        para("The pipeline runs 9 sequential steps. Each step has built-in retry with exponential backoff (2 attempts). Failed steps degrade gracefully where possible."),
        spacer(120),

        // Stage 1: Lock
        stageBox(1, "Lock Acquisition", [
          "Creates a BomPipelineRun row with status=RUNNING",
          "Partial unique index enforces one RUNNING run per deal at the database level",
          "Stale locks (>10 minutes) are auto-recovered via atomic transaction",
          "Throws DuplicateRunError if another run is genuinely in-flight",
        ]),
        spacer(160),

        // Stage 2: Fetch Deal
        stageBox(2, "Fetch Deal", [
          "Reads HubSpot deal properties + associated contact ID",
          "Gets deal name, project ID, pipeline, stage, and contact info",
          "Retry: 2 attempts, 3s delay + jitter",
        ]),
        spacer(160),

        // Stage 3: List PDFs
        stageBox(3, "List Planset PDFs", [
          "Queries Google Drive for planset PDFs linked to the deal",
          "Selects the most recent stamped planset by naming convention",
          "Retry: 2 attempts, 3s delay + jitter",
        ]),
        spacer(160),

        // Stage 4: Extract BOM
        stageBox(4, "Extract BOM (Claude AI)", [
          [bold("Model: "), new TextRun({ text: "Claude Opus 4.5 with vision", font: "Arial", size: 19, color: MID })],
          "PDFs > 20MB are stripped to first 8 pages (PV-0 through PV-6 + buffer)",
          "Upload via Anthropic Files API; fallback to base64 inline if Files API fails (<45MB)",
          "138KB system prompt with extraction rules, equipment categories, and validation logic",
          [bold("Output: "), new TextRun({ text: "project metadata + BomItem[] + validation cross-checks", font: "Arial", size: 19, color: MID })],
          "Retry: 2 attempts, 5s delay + jitter",
        ]),
        spacer(160),

        // Stage 5: Save Snapshot
        stageBox(5, "Save Snapshot + Catalog Match", [
          "Auto-increments version per deal (query MAX, add 1)",
          [bold("BOM Post-Processing "), new TextRun({ text: "(if ENABLE_BOM_POST_PROCESS):", font: "Arial", size: 19, color: MID })],
          "  \u2013 Category standardization (PV_MODULE \u2192 MODULE)",
          "  \u2013 Brand filling from model patterns (Tesla part #s, Enphase, etc.)",
          "  \u2013 Model standardization (natural language \u2192 part numbers)",
          "  \u2013 Qty adjustment suggestions (logged, NOT mutated)",
          "  \u2013 OPS_STANDARD suggested additions (separate from items[])",
          "Saves ProjectBomSnapshot to Postgres with bomData JSON blob",
          [bold("SKU Sync (4-phase sequential matching):"), new TextRun({ text: "", font: "Arial", size: 19 })],
          "  Phase 1: Exact canonical key (category+brand+model)",
          "  Phase 2: Alias/family matching (normalized name extraction)",
          "  Phase 3: Zoho Inventory lookup by name/SKU",
          "  Phase 4: Create PendingCatalogPush for unmatched items (90-day TTL)",
        ]),
        spacer(160),

        // Stage 6: Resolve Customer
        stageBox(6, "Resolve Zoho Customer", [
          "Multi-strategy lookup (stops on first match):",
          "  Strategy 1: HubSpot contact ID \u2192 Zoho customer cache",
          "  Strategy 2: Deal name parsing (text after pipe) \u2192 Zoho name search",
          "  Strategy 3: HubSpot contact email/phone/name \u2192 Zoho lookup",
          "  Strategy 4: Address disambiguation for multiple candidates",
          [bold("Not found? "), new TextRun({ text: "\u2192 Graceful degradation: status=PARTIAL, BOM saved, SO skipped", font: "Arial", size: 19, color: MID })],
        ]),
        spacer(160),

        // Stage 7: Create SO
        stageBox(7, "Create Zoho Sales Order", [
          [bold("Idempotency: "), new TextRun({ text: "returns existing SO if zohoSoId already set on snapshot", font: "Arial", size: 19, color: MID })],
          "Sequential item matching to Zoho Inventory (one-by-one to avoid rate limits)",
          [bold("SO Post-Processing "), new TextRun({ text: "(if ENABLE_SO_POST_PROCESS) \u2014 MUTATING:", font: "Arial", size: 19, color: MID })],
          "  \u2013 Job context detection (solar/hybrid/battery, roof type, flags)",
          "  \u2013 Category-specific rules (racking qty, OCPD sizing, disconnects)",
          "  \u2013 Deduplication by normalized SKU",
          "  \u2013 SKU swaps, qty corrections, item additions",
          "Creates draft Zoho SO named SO-PROJ-{projId}",
          "Stores zohoSoId on snapshot for idempotency",
          "Stale SO recovery: if creation fails with \u201Calready exists\u201D, fetches and patches",
        ]),
        spacer(160),

        // Stage 8: Create Purchase Orders
        stageBox(8, "Create Purchase Orders (Conditional)", [
          [bold("Gate logic: "), new TextRun({ text: "only runs under specific conditions:", font: "Arial", size: 19, color: MID })],
          "  \u2013 RTB webhook trigger + PIPELINE_AUTO_CREATE_PO_ON_RTB=true \u2192 auto-create",
          "  \u2013 MANUAL trigger + existing POs on snapshot \u2192 continue/recover incomplete POs",
          "  \u2013 Otherwise \u2192 skipped entirely",
          [bold("Vendor grouping "), new TextRun({ text: "(resolvePoVendorGroups):", font: "Arial", size: 19, color: MID })],
          "  \u2013 Matches each BOM item to Zoho Inventory sequentially",
          "  \u2013 Groups items by preferred vendor (vendor_id from Zoho)",
          "  \u2013 Items without a Zoho match or without a vendor go to unassignedItems[]",
          [bold("PO creation "), new TextRun({ text: "(one draft PO per vendor):", font: "Arial", size: 19, color: MID })],
          "  \u2013 Skips vendors that already have a PO (idempotent per-vendor)",
          "  \u2013 Persist-as-you-go: snapshot updated after EACH successful PO creation",
          "  \u2013 If a vendor PO fails, the error is captured but others continue",
          "  \u2013 No withRetry wrapper \u2014 internal persist-as-you-go handles partial failure",
          [bold("Frozen groupings: "), new TextRun({ text: "once POs exist on a snapshot, vendor groups are frozen from bomData.poVendorGroups to prevent re-grouping drift on retry", font: "Arial", size: 19, color: MID })],
          [bold("Reference number: "), new TextRun({ text: "PROJ-XXXX V{version} \u2014 {vendorName} (max 50 chars)", font: "Arial", size: 19, color: MID })],
        ]),
        spacer(160),

        // Stage 9: Notify
        stageBox(9, "Notify + Complete", [
          "Emails ops team with result (success/partial/failed)",
          "Logs ActivityLog entry for audit trail",
          "Releases pipeline lock (RUNNING \u2192 SUCCESS/PARTIAL/FAILED)",
          "Returns PipelineResult with counts, durations, and corrections log",
        ]),
        spacer(200),

        // ── KEY FILES ─────────────────────────────────────────
        new Paragraph({ children: [new PageBreak()] }),
        heading("Key Files"),
        table2(
          ["File", "Purpose"],
          [
            ["lib/bom-pipeline.ts", "Orchestrator \u2014 runs all stages, retry logic, lock management"],
            ["lib/bom-extract.ts", "Stage 4 \u2014 Claude vision PDF extraction"],
            ["lib/bom-snapshot.ts", "Stage 5 \u2014 version mgmt, catalog matching, snapshot persistence"],
            ["lib/bom-catalog-match.ts", "Catalog matching engine (exact \u2192 alias \u2192 Zoho \u2192 pending)"],
            ["lib/bom-hubspot-line-items.ts", "HubSpot line item push with lock-based concurrency"],
            ["lib/bom-so-create.ts", "Stage 7 \u2014 Zoho Sales Order creation"],
            ["lib/bom-post-process.ts", "BOM normalization (categories, brands, models) \u2014 non-mutating"],
            ["lib/bom-so-post-process.ts", "SO line item corrections \u2014 mutating (SKU swaps, qty changes)"],
            ["lib/bom-customer-resolve.ts", "Multi-strategy Zoho customer resolution"],
            ["lib/bom-po-create.ts", "Stage 8 \u2014 vendor grouping + per-vendor PO creation"],
            ["lib/bom-search-terms.ts", "BOM item \u2192 Zoho search term builder (shared by SO + PO)"],
            ["lib/bom-pipeline-lock.ts", "Pipeline lock acquisition and stale recovery"],
          ],
          [3400, 5960],
        ),
        spacer(200),

        // ── CONCURRENCY & LOCKING ─────────────────────────────
        heading("Concurrency & Locking"),
        para("Two independent locks prevent concurrent mutations on the same deal:"),
        spacer(60),
        table2(
          ["Lock", "Model", "Index", "Stale Threshold"],
          [
            ["Pipeline lock", "BomPipelineRun", "(dealId) WHERE status=\u2018RUNNING\u2019", "10 minutes"],
            ["HubSpot push lock", "BomHubSpotPushLog", "(dealId) WHERE status=\u2018PENDING\u2019", "5 minutes"],
          ],
          [2000, 2600, 3160, 1600],
        ),
        spacer(120),
        calloutBox("How stale recovery works", "Both locks use the same atomic pattern: a Prisma transaction marks the stale row as FAILED, then inserts a new RUNNING/PENDING row. If the transaction fails (P2002 unique violation), another run genuinely holds the lock."),
        spacer(200),

        // ── DATABASE MODELS ───────────────────────────────────
        heading("Database Models"),
        table2(
          ["Model", "Purpose"],
          [
            ["BomPipelineRun", "Pipeline execution tracking (status, step, error, duration, metadata JSONB)"],
            ["ProjectBomSnapshot", "BOM data blob (JSON), version, source file, zohoSoId for idempotency"],
            ["BomHubSpotPushLog", "HubSpot push tracking (items pushed/skipped/deleted, lock status)"],
            ["InternalProduct", "Product catalog with brand, model, category, Zoho/HubSpot IDs"],
            ["PendingCatalogPush", "Unmatched items queued for catalog review (90-day TTL)"],
            ["BomToolFeedback", "User corrections and extraction issues (feedback loop)"],
            ["CatalogMatchGroup", "Groups matched products by canonical key for dedup"],
          ],
          [3200, 6160],
        ),
        spacer(200),

        // ── EXTERNAL APIS ─────────────────────────────────────
        heading("External API Calls"),
        table2(
          ["Service", "API", "Usage"],
          [
            ["Anthropic", "Files API + Messages API", "BOM extraction via Claude Opus 4.5 vision"],
            ["Google Drive", "Files: list, get, download", "Find and download planset PDFs"],
            ["HubSpot", "Deals, Contacts, Line Items, Products", "Fetch deal props, create line items, resolve contacts"],
            ["Zoho Inventory", "Items, SOs, POs, Customers", "Match items, create SO + POs, resolve customers"],
          ],
          [1800, 3000, 4560],
        ),
        spacer(200),

        // ── RETRY STRATEGY ────────────────────────────────────
        heading("Retry Strategy"),
        para("Two layers of retry protect against transient failures:"),
        spacer(60),
        heading("Layer 1: Built-in Step Retry", HeadingLevel.HEADING_3),
        para("Each pipeline step uses withRetry() with exponential backoff. Retryable patterns: HTTP 500/502/503/429/529, ECONNRESET, ETIMEDOUT, rate limit messages."),
        spacer(60),
        table2(
          ["Step", "Max Attempts", "Base Delay", "Jitter"],
          [
            ["FETCH_DEAL", "2", "3,000ms", "1,000ms"],
            ["LIST_PDFS", "2", "3,000ms", "1,000ms"],
            ["EXTRACT_BOM", "2", "5,000ms", "2,000ms"],
            ["SAVE_SNAPSHOT", "2", "2,000ms", "500ms"],
            ["RESOLVE_CUSTOMER", "2", "2,000ms", "500ms"],
            ["CREATE_SO", "2", "3,000ms", "1,000ms"],
          ],
          [2800, 2000, 2280, 2280],
        ),
        spacer(120),
        heading("Layer 2: AI Escalation (Optional)", HeadingLevel.HEADING_3),
        para("If PIPELINE_AI_ESCALATION_ENABLED=true, failed runs are analyzed by Claude Haiku to classify errors as transient vs. permanent. 30-minute cooldown prevents retry loops. Safe fallback: never retries if escalation itself errors."),
        spacer(200),

        // ── FEATURE FLAGS ─────────────────────────────────────
        new Paragraph({ children: [new PageBreak()] }),
        heading("Feature Flags"),
        table2(
          ["Flag", "Default", "Controls"],
          [
            ["DESIGN_COMPLETE_AUTO_ENABLED", "false", "Webhook-triggered auto pipeline"],
            ["PIPELINE_AUTO_RETRY_ENABLED", "true", "Built-in step retry (Layer 1)"],
            ["PIPELINE_AI_ESCALATION_ENABLED", "false", "Claude Haiku error classification (Layer 2)"],
            ["PIPELINE_AUTO_CREATE_PO_ON_RTB", "false", "Auto-create purchase orders on ready_to_build"],
            ["ENABLE_BOM_POST_PROCESS", "\u2014", "BOM normalization before snapshot save"],
            ["ENABLE_SO_POST_PROCESS", "\u2014", "SO line item corrections before Zoho creation"],
            ["CATALOG_PENDING_TTL_DAYS", "90", "Expiry for unmatched items in review queue"],
          ],
          [3600, 1000, 4760],
        ),
        spacer(200),

        // ── BOM ITEM SCHEMA ───────────────────────────────────
        heading("BomItem Schema"),
        para("Every extracted item follows this shape:"),
        spacer(60),
        table2(
          ["Field", "Type", "Description"],
          [
            ["lineItem", "number", "Sequential line number from extraction"],
            ["category", "string", "MODULE | INVERTER | BATTERY | BATTERY_EXPANSION | EV_CHARGER | RACKING | ELECTRICAL_BOS | MONITORING | RAPID_SHUTDOWN"],
            ["brand", "string", "Manufacturer name (normalized)"],
            ["model", "string", "Model/part number (normalized)"],
            ["description", "string", "Human-readable description"],
            ["qty", "number", "Quantity (integer, > 0)"],
            ["unitSpec", "string?", "Unit specification (e.g., wattage for modules)"],
            ["unitLabel", "string?", "Unit label (e.g., \u201CW\u201D, \u201CkWh\u201D)"],
            ["source", "string", "PV-2 | PV-4 | PV-0 | OPS_STANDARD"],
            ["flags", "string[]?", "INFERRED | ASSUMED_BRAND | VALIDATION_WARNING"],
          ],
          [1600, 1600, 6160],
        ),
        spacer(200),

        // ── POST-PROCESSING ───────────────────────────────────
        heading("Post-Processing: BOM vs SO"),
        spacer(60),
        calloutBox(
          "Critical Distinction",
          "BOM post-processing (bom-post-process.ts) is NON-MUTATING on quantities \u2014 it only suggests adjustments. SO post-processing (bom-so-post-process.ts) IS MUTATING \u2014 it modifies line items before Zoho creation.",
          RED,
        ),
        spacer(160),

        heading("BOM Post-Processor (before snapshot save)", HeadingLevel.HEADING_3),
        para([bold("File: "), mono("src/lib/bom-post-process.ts")]),
        spacer(60),
        table2(
          ["Rule", "Action", "Mutates items[]?"],
          [
            ["Category standardization", "PV_MODULE \u2192 MODULE, MOUNT \u2192 RACKING, etc.", "Yes (category only)"],
            ["Brand filling", "Infer brand from model patterns (Tesla, Enphase, etc.)", "Yes (brand only)"],
            ["Model standardization", "Natural language \u2192 part numbers", "Yes (model only)"],
            ["Qty adjustments", "Suggest corrections based on module count", "No \u2014 logged separately"],
            ["Suggested additions", "OPS_STANDARD items (snow dogs, strain relief, etc.)", "No \u2014 separate array"],
          ],
          [2400, 4560, 2400],
        ),
        spacer(160),

        heading("SO Post-Processor (before Zoho creation)", HeadingLevel.HEADING_3),
        para([bold("File: "), mono("src/lib/bom-so-post-process.ts")]),
        spacer(60),
        para([bold("Job Context Detection \u2014 "), new TextRun({ text: "analyzes items + project metadata to determine:", font: "Arial", size: 22 })]),
        spacer(40),
        table2(
          ["Context Field", "Values", "Detection"],
          [
            ["jobType", "solar | hybrid | battery_only", "Based on presence of modules and/or batteries"],
            ["roofType", "asphalt_shingle | standing_seam_metal | tile | trapezoidal_metal", "Based on racking items (S-5, L-Foot, ProteaBracket)"],
            ["hasPowerwall", "boolean", "Model matches /1707000/"],
            ["hasEnphase", "boolean", "Brand/model matches /enphase|IQ8|Q-12-RAW/"],
            ["moduleCount", "number", "Sum of MODULE item quantities"],
            ["arrayCount", "number", "From project.arrays.length or project.arrayCount"],
          ],
          [2200, 3200, 3960],
        ),
        spacer(120),
        para([bold("Correction types applied: "), new TextRun({ text: "sku_swap, qty_adjust, item_removed, item_added, dedup_merge", font: "Arial", size: 22 })]),
        spacer(200),

        // ── API ROUTES ────────────────────────────────────────
        new Paragraph({ children: [new PageBreak()] }),
        heading("API Routes"),
        para("All BOM routes are under /api/bom/ and require role: ADMIN, EXECUTIVE, PM, OPS_MGR, OPS, or TECH_OPS."),
        spacer(60),
        table2(
          ["Endpoint", "Method", "Description"],
          [
            ["/api/bom/extract", "POST", "Direct PDF extraction (SSE-streamed results)"],
            ["/api/bom/history", "POST", "Save BOM snapshot manually"],
            ["/api/bom/push-to-hubspot", "POST", "Push snapshot line items to HubSpot deal"],
            ["/api/bom/create-so", "POST", "Create Zoho Sales Order from snapshot"],
            ["/api/bom/pipeline-retry", "POST", "Retry a failed pipeline run"],
            ["/api/bom/zoho-so", "GET", "Fetch Zoho SO details"],
            ["/api/bom/zoho-customers", "GET", "Search Zoho customers"],
            ["/api/bom/resolve-customer", "POST", "Multi-strategy customer resolution"],
            ["/api/bom/linked-products", "GET", "Get catalog-linked products for a snapshot"],
            ["/api/bom/create-po", "POST", "Create per-vendor Purchase Orders from snapshot"],
            ["/api/bom/po-preview", "GET", "Preview vendor groupings before PO creation"],
            ["/api/bom/feedback", "POST", "Submit extraction feedback"],
            ["/api/bom/export-pdf", "POST", "Generate BOM PDF export"],
            ["/api/bom/upload", "POST", "Upload planset PDF"],
            ["/api/bom/drive-files", "GET", "List Drive files for a deal"],
            ["/api/bom/chunk", "POST", "Chunked upload for large files"],
          ],
          [2800, 1000, 5560],
        ),
        spacer(200),

        // ── GOTCHAS ───────────────────────────────────────────
        heading("Critical Gotchas"),
        spacer(60),

        ...[
          ["Zoho matching is sequential", "Concurrent requests trigger rate limits. All item matching to Zoho Inventory is done one-by-one, never parallelized."],
          ["BOM post-process is non-mutating on qty", "Quantity adjustment suggestions are logged separately and never modify items[]. OPS_STANDARD suggested additions are also kept in a separate array."],
          ["SO post-process IS mutating", "Unlike BOM post-processing, SO post-processing directly modifies line items before Zoho creation (SKU swaps, qty adjustments, additions)."],
          ["Graceful degradation", "If customer resolution fails, the pipeline returns status=PARTIAL instead of FAILED. The BOM snapshot is still saved and can be retried."],
          ["PDF page stripping", "Plansets over 20MB are trimmed to the first 8 pages (PV-0 through PV-6 + buffer) before sending to Claude, removing equipment spec sheets."],
          ["Base64 fallback", "If the Anthropic Files API fails with PDF processing errors and the file is under 45MB, extraction retries with inline base64 encoding."],
          ["Idempotency guard", "The zohoSoId stored on ProjectBomSnapshot prevents duplicate Sales Order creation on retry. Always check this before creating."],
          ["PO creation is persist-as-you-go", "Each vendor PO is persisted to the snapshot immediately after creation. If the pipeline crashes mid-way through vendors, a MANUAL retry picks up where it left off using frozen vendor groups from bomData.poVendorGroups. Vendors with existing POs are skipped."],
          ["PO gate is state-based, not just flag-based", "MANUAL retries bypass the PIPELINE_AUTO_CREATE_PO_ON_RTB flag if POs already exist on the snapshot. This ensures recovery works even if the flag is later turned off."],
          ["Lock stale recovery is atomic", "Marking a stale lock as FAILED and inserting a new RUNNING lock happen in a single Prisma transaction. If the transaction fails with P2002 (unique violation), another run genuinely holds the lock."],
        ].map(([title, desc], i) => [
          new Paragraph({
            numbering: { reference: "gotchas", level: 0 },
            spacing: { after: 40 },
            children: [bold(`${title}: `), new TextRun({ text: desc, font: "Arial", size: 22 })],
          }),
          spacer(80),
        ]).flat(),

        spacer(200),

        // ── ERROR HANDLING ────────────────────────────────────
        heading("Error Handling Patterns"),
        table2(
          ["Error Type", "Behavior"],
          [
            ["HTTP 429 (rate limit)", "Exponential backoff via withRetry(), max 2 attempts"],
            ["HTTP 500/502/503", "Exponential backoff, classified as transient"],
            ["ECONNRESET / ETIMEDOUT", "Exponential backoff, classified as transient"],
            ["HTTP 403/404", "Immediate failure, not retried"],
            ["Prisma P2002 (unique)", "Caught as DuplicateRunError/DuplicatePushError"],
            ["PDF processing error", "Falls back to base64 inline extraction if < 45MB"],
            ["Customer not found", "Graceful degradation to PARTIAL status"],
            ["Zoho \u201Calready exists\u201D", "Fetches existing SO and patches custom field link"],
            ["Catalog gap", "Creates PendingCatalogPush record, notifies admins"],
          ],
          [3200, 6160],
        ),
      ],
    },
  ],
});

// ── Write file ────────────────────────────────────────────────
async function main() {
  const buffer = await Packer.toBuffer(doc);
  const outPath = "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/docs/BOM-Pipeline-Developer-Guide.docx";
  fs.writeFileSync(outPath, buffer);
  console.log(`Written to ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
}

main().catch(console.error);
