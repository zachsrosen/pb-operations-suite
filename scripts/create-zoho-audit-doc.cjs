const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat,
} = require("/opt/homebrew/lib/node_modules/docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Colors
const PB_ORANGE = "E87722";
const PB_DARK = "1A1A2E";
const HEADER_BG = "F0F4F8";
const CRITICAL_BG = "FDE8E8";
const WARNING_BG = "FEF3C7";
const OK_BG = "D1FAE5";

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: PB_DARK, type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 })],
    })],
  });
}

function dataCell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.bg ? { fill: opts.bg, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({
        text,
        bold: opts.bold || false,
        color: opts.color || "333333",
        font: "Arial",
        size: opts.size || 20,
      })],
    })],
  });
}

function numCell(text, width, opts = {}) {
  return dataCell(text, width, { ...opts, align: AlignmentType.RIGHT });
}

// Summary table data
const summaryData = [
  { issue: "Sell = Cost (identical)", count: "892", pct: "54%", severity: "critical", bg: CRITICAL_BG },
  { issue: "Both Zero (no prices)", count: "477", pct: "29%", severity: "high", bg: WARNING_BG },
  { issue: "Sell is Zero (cost exists)", count: "195", pct: "12%", severity: "high", bg: WARNING_BG },
  { issue: "Missing Cost (sell exists)", count: "41", pct: "2%", severity: "medium", bg: HEADER_BG },
  { issue: "OK (sell \u2260 cost, both > 0)", count: "46", pct: "3%", severity: "ok", bg: OK_BG },
];

// Build doc
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Arial", size: 22 } },
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: PB_DARK },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: PB_ORANGE },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "444444" },
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
        reference: "numbers2",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PB_ORANGE, space: 1 } },
          children: [
            new TextRun({ text: "PHOTON BROTHERS", bold: true, font: "Arial", size: 18, color: PB_ORANGE }),
            new TextRun({ text: "  |  Zoho Inventory Pricing Audit", font: "Arial", size: 18, color: "888888" }),
          ],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Confidential \u2014 Photon Brothers Internal  |  Page ", font: "Arial", size: 16, color: "999999" }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" }),
          ],
        })],
      }),
    },
    children: [
      // Title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: "Zoho Inventory Pricing Audit", bold: true, font: "Arial", size: 48, color: PB_DARK })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: "Data Quality Report  |  March 2026", font: "Arial", size: 24, color: "666666" })],
      }),

      // Executive Summary
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Executive Summary")] }),
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun("An automated audit of all "),
          new TextRun({ text: "1,651 items", bold: true }),
          new TextRun(" in Zoho Inventory reveals that "),
          new TextRun({ text: "97% have a pricing issue", bold: true, color: "DC2626" }),
          new TextRun(". Only "),
          new TextRun({ text: "46 items (3%)", bold: true }),
          new TextRun(" have properly differentiated sell prices vs. purchase costs. This affects SO accuracy, margin reporting, and customer-facing pricing across all departments."),
        ],
      }),

      // Key Finding callout
      new Paragraph({
        spacing: { before: 200, after: 200 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 2, color: PB_ORANGE },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: PB_ORANGE },
          left: { style: BorderStyle.SINGLE, size: 6, color: PB_ORANGE },
          right: { style: BorderStyle.SINGLE, size: 2, color: PB_ORANGE },
        },
        indent: { left: 360, right: 360 },
        children: [
          new TextRun({ text: "  KEY FINDING:  ", bold: true, color: PB_ORANGE, size: 22 }),
          new TextRun({ text: "54% of Zoho items have their sell price set to the exact same value as their purchase cost. This means pricing was either never configured, or an import/migration copied cost into the sell price field.", size: 22 }),
        ],
      }),

      // Summary Table
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Audit Results Summary")] }),

      // The table
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4200, 1500, 1200, 2460],
        rows: [
          new TableRow({
            children: [
              headerCell("Issue", 4200),
              headerCell("Count", 1500),
              headerCell("% of Total", 1200),
              headerCell("Impact", 2460),
            ],
          }),
          ...summaryData.map(row => new TableRow({
            children: [
              dataCell(row.issue, 4200, { bold: true, bg: row.bg }),
              numCell(row.count, 1500, { bold: true, bg: row.bg }),
              numCell(row.pct, 1200, { bg: row.bg }),
              dataCell(
                row.severity === "critical" ? "SOs show wrong margins"
                  : row.severity === "high" ? "SOs show $0 line items"
                  : row.severity === "medium" ? "Cost tracking incomplete"
                  : "Correctly configured",
                2460,
                { bg: row.bg, size: 18, color: "666666" }
              ),
            ],
          })),
          // Total row
          new TableRow({
            children: [
              dataCell("TOTAL", 4200, { bold: true, bg: PB_DARK, color: "FFFFFF" }),
              numCell("1,651", 1500, { bold: true, bg: PB_DARK, color: "FFFFFF" }),
              numCell("100%", 1200, { bg: PB_DARK, color: "FFFFFF" }),
              dataCell("", 2460, { bg: PB_DARK }),
            ],
          }),
        ],
      }),

      new Paragraph({ spacing: { after: 200 }, children: [] }),

      // Detailed Breakdown
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Detailed Breakdown")] }),

      // 1. Sell = Cost
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("1. Sell Price = Purchase Cost (892 items, 54%)")] }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("These items have their sell price set to the exact same value as their purchase cost. This is the most common issue and suggests a systemic data entry or import problem. Examples include:")],
      }),
      ...["IronRidge XR10 14ft Rail: sell = cost = $25.66", "IronRidge Halo UltraGrip: sell = cost = $6.04", "60A Non-Fusible Disconnect: sell = cost = $99.92", "Enphase IQ8MC Microinverter: sell = cost = $133.33", "Tesla Gateway 3: sell = cost = $835.00"].map(text =>
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text, size: 20 })],
        })
      ),
      new Paragraph({
        spacing: { before: 120, after: 200 },
        children: [
          new TextRun({ text: "Impact: ", bold: true }),
          new TextRun("Any SO created from these items will show 0% margin. Revenue and margin reports are inaccurate for any deal using these products."),
        ],
      }),

      // 2. Both Zero
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2. Both Prices Zero (477 items, 29%)")] }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("These items have no pricing data at all \u2014 both sell and cost are $0. Many are active inventory items used on jobs regularly. Examples include:")],
      }),
      ...["#10 THHN wire (multiple colors)", "1-1/4\" EMT conduit", "Various breakers and fuses", "PVC conduit fittings"].map(text =>
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text, size: 20 })],
        })
      ),
      new Paragraph({
        spacing: { before: 120, after: 200 },
        children: [
          new TextRun({ text: "Impact: ", bold: true }),
          new TextRun("SOs for these items show $0 line items. Job costing and inventory valuation are understated."),
        ],
      }),

      // 3. Sell is Zero
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("3. Sell Price is Zero, Cost Exists (195 items, 12%)")] }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("These items have a valid purchase cost but no sell price. The cost data is usable, but any customer-facing document will show $0. Examples include:")],
      }),
      ...["1 AWG THHN wire: cost = $2.61, sell = $0", "Aluminum Flex 1\": cost = $98.41, sell = $0", "EMT conduit straps: cost = $0.73\u2013$1.70, sell = $0"].map(text =>
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text, size: 20 })],
        })
      ),
      new Paragraph({
        spacing: { before: 120, after: 200 },
        children: [
          new TextRun({ text: "Impact: ", bold: true }),
          new TextRun("These are the easiest to fix \u2014 cost data exists, only sell prices need to be set."),
        ],
      }),

      // Page break before recommendations
      new Paragraph({ children: [new PageBreak()] }),

      // Recommendations
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Recommendations")] }),

      // Immediate
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Immediate Actions")] }),
      ...[
        "Decide ownership: Who is responsible for maintaining Zoho pricing? This has never been clearly assigned.",
        "Fix the 195 items with cost but zero sell price. These already have cost data \u2014 only sell prices need to be added. This is the lowest-effort, highest-impact fix.",
        "Audit the 892 items where sell = cost. For each, determine: is the value actually the cost (and sell price needs to be set), or is it the sell price (and cost needs correction)?",
      ].map(text =>
        new Paragraph({
          numbering: { reference: "numbers", level: 0 },
          spacing: { after: 100 },
          children: [new TextRun({ text, size: 20 })],
        })
      ),

      // Strategic
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Strategic Decisions")] }),
      ...[
        "Clarify which system is the source of truth for each price type. Currently: HubSpot has retail/customer pricing for major equipment, Zoho has wholesale/cost data. Neither is complete.",
        "Establish a pricing update workflow. When vendor costs change, who updates Zoho? When customer pricing changes, who updates HubSpot?",
        "Consider whether Zoho should hold sell prices at all, or if HubSpot should be the sole source for customer-facing pricing.",
      ].map(text =>
        new Paragraph({
          numbering: { reference: "numbers2", level: 0 },
          spacing: { after: 100 },
          children: [new TextRun({ text, size: 20 })],
        })
      ),

      new Paragraph({ spacing: { after: 200 }, children: [] }),

      // Cross-System Pricing Observations
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Cross-System Pricing Observations")] }),
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun("For the 51 products linked between our Internal Catalog, Zoho, and HubSpot, the pricing tells a clear story about how each system is being used:")],
      }),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2800, 1640, 1640, 1640, 1640],
        rows: [
          new TableRow({
            children: [
              headerCell("Product", 2800),
              headerCell("Internal", 1640),
              headerCell("Zoho", 1640),
              headerCell("HubSpot", 1640),
              headerCell("Observation", 1640),
            ],
          }),
          ...[
            { name: "Tesla PW3", internal: "\u2014", zoho: "$7,600", hs: "$13,900", note: "Retail vs cost" },
            { name: "PW3 Expansion", internal: "\u2014", zoho: "$5,650", hs: "$10,900", note: "Retail vs cost" },
            { name: "Backup Switch", internal: "\u2014", zoho: "$305", hs: "$500", note: "Retail vs cost" },
            { name: "IQ8MC Micro", internal: "\u2014", zoho: "$133", hs: "$295", note: "Retail vs cost" },
            { name: "Silfab 400 HC+", internal: "\u2014", zoho: "$188", hs: "$245", note: "$57 gap" },
            { name: "IQ Combiner 5", internal: "\u2014", zoho: "$1", hs: "$1", note: "Both wrong" },
            { name: "Enphase RMA", internal: "$650", zoho: "$650", hs: "$650", note: "All match" },
          ].map(row => new TableRow({
            children: [
              dataCell(row.name, 2800, { size: 18 }),
              numCell(row.internal, 1640, { size: 18 }),
              numCell(row.zoho, 1640, { size: 18 }),
              numCell(row.hs, 1640, { size: 18 }),
              dataCell(row.note, 1640, { size: 16, color: "666666" }),
            ],
          })),
        ],
      }),

      new Paragraph({
        spacing: { before: 160, after: 200 },
        children: [
          new TextRun({ text: "Pattern: ", bold: true }),
          new TextRun("HubSpot consistently stores the customer-facing retail price. Zoho stores the wholesale/procurement cost. The Internal Catalog is empty for almost everything. This suggests a natural system-of-record split, but it was never formalized."),
        ],
      }),

      // Methodology
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Methodology")] }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("This audit was performed using an automated endpoint that scans all Zoho Inventory items via the API. Each item was classified by comparing its sell price (rate) against its purchase cost (purchase_rate):")],
      }),
      ...["OK: sell > 0, cost > 0, sell \u2260 cost", "Sell = Cost: sell > 0, cost > 0, sell = cost", "Both Zero: sell = 0, cost = 0", "Sell is Zero: sell = 0, cost > 0", "Missing Cost: sell > 0, cost = 0 or null"].map(text =>
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text, size: 20 })],
        })
      ),
      new Paragraph({
        spacing: { before: 120 },
        children: [
          new TextRun({ text: "Audit endpoint: ", italics: true, color: "666666", size: 18 }),
          new TextRun({ text: "GET /api/catalog/zoho-pricing-audit", italics: true, color: "666666", size: 18 }),
        ],
      }),
    ],
  }],
});

const outPath = "/Users/zach/Downloads/Zoho-Pricing-Audit-March2026.docx";
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log("Created:", outPath);
});
