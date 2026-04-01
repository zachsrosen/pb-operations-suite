const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, LevelFormat, ShadingType,
  Header, Footer, PageNumber,
} = require("docx");

const DIR = __dirname;
const OUT = path.join(DIR, "docx");

const MD_FILES = [
  "01-sales-team.md",
  "02-project-management.md",
  "03-operations.md",
  "04-design-engineering.md",
  "05-permitting-interconnection.md",
  "06-field-tech-ops.md",
  "07-service-warranty.md",
  "08-admin-management.md",
];

// PB brand-adjacent colors
const ACCENT = "D97706"; // amber-600
const LIGHT_BG = "FFF7ED"; // amber-50
const BORDER_COLOR = "E5E7EB";
const MUTED = "6B7280";

function parseMarkdown(content) {
  const lines = content.split("\n");
  const elements = [];
  let inBlockquote = false;
  let blockquoteLines = [];

  function flushBlockquote() {
    if (blockquoteLines.length > 0) {
      const text = blockquoteLines.join(" ").replace(/\s+/g, " ").trim();
      elements.push({ type: "blockquote", text });
      blockquoteLines = [];
      inBlockquote = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blockquote
    if (line.startsWith("> ")) {
      inBlockquote = true;
      blockquoteLines.push(line.slice(2).trim());
      continue;
    } else if (inBlockquote && line.trim() === ">") {
      blockquoteLines.push("");
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push({ type: "hr" });
      continue;
    }

    // H1
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      elements.push({ type: "h1", text: line.slice(2).trim() });
      continue;
    }

    // H2
    if (line.startsWith("## ")) {
      elements.push({ type: "h2", text: line.slice(3).trim() });
      continue;
    }

    // H3
    if (line.startsWith("### ")) {
      elements.push({ type: "h3", text: line.slice(4).trim() });
      continue;
    }

    // Numbered question (e.g., "1.1. What is your...")
    const qMatch = line.match(/^(\d+\.\d+)\.\s+(.+)$/);
    if (qMatch) {
      elements.push({ type: "question", num: qMatch[1], text: qMatch[2] });
      continue;
    }

    // Sub-item with dash (e.g., "   - System not producing")
    if (/^\s+-\s+/.test(line)) {
      elements.push({ type: "bullet", text: line.replace(/^\s+-\s+/, "").trim() });
      continue;
    }

    // Italic/emphasis line (closing message)
    const italicMatch = line.match(/^\*(.+)\*$/);
    if (italicMatch) {
      elements.push({ type: "italic", text: italicMatch[1] });
      continue;
    }

    // Regular paragraph
    if (line.trim().length > 0) {
      elements.push({ type: "paragraph", text: line.trim() });
    }
  }

  flushBlockquote();
  return elements;
}

function buildDoc(elements, filename) {
  const children = [];

  // Extract title from first h1
  const titleEl = elements.find((e) => e.type === "h1");
  const title = titleEl ? titleEl.text : filename;

  for (const el of elements) {
    switch (el.type) {
      case "h1":
        // Title - large, colored
        children.push(
          new Paragraph({
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({
                text: el.text,
                bold: true,
                size: 48, // 24pt
                font: "Arial",
                color: ACCENT,
              }),
            ],
          })
        );
        // Accent line under title
        children.push(
          new Paragraph({
            spacing: { after: 300 },
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: ACCENT,
                space: 4,
              },
            },
            children: [],
          })
        );
        break;

      case "blockquote":
        // Info box - left border accent, light background
        children.push(
          new Paragraph({
            spacing: { before: 100, after: 200 },
            indent: { left: 360, right: 360 },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                size: 12,
                color: ACCENT,
                space: 8,
              },
            },
            shading: { fill: LIGHT_BG, type: ShadingType.CLEAR },
            children: parseInlineFormatting(el.text, {
              size: 20,
              font: "Arial",
              color: "374151",
            }),
          })
        );
        break;

      case "h2":
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 360, after: 160 },
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 2,
                color: BORDER_COLOR,
                space: 4,
              },
            },
            children: [
              new TextRun({
                text: el.text,
                bold: true,
                size: 28, // 14pt
                font: "Arial",
                color: "111827",
              }),
            ],
          })
        );
        break;

      case "h3":
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: el.text,
                bold: true,
                size: 24,
                font: "Arial",
                color: "374151",
              }),
            ],
          })
        );
        break;

      case "question":
        // Question number in accent, question text in regular
        children.push(
          new Paragraph({
            spacing: { before: 200, after: 40 },
            children: [
              new TextRun({
                text: el.num + "  ",
                bold: true,
                size: 22,
                font: "Arial",
                color: ACCENT,
              }),
              ...parseInlineFormatting(el.text, {
                size: 22,
                font: "Arial",
                color: "111827",
              }),
            ],
          })
        );
        // Answer area - light gray line
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 120 },
            indent: { left: 540 },
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 1,
                color: "E5E7EB",
                space: 2,
              },
            },
            children: [
              new TextRun({
                text: " ",
                size: 22,
                font: "Arial",
                color: "9CA3AF",
              }),
            ],
          })
        );
        break;

      case "bullet":
        children.push(
          new Paragraph({
            spacing: { before: 40, after: 40 },
            indent: { left: 900, hanging: 180 },
            children: [
              new TextRun({
                text: "\u2013 ",
                size: 20,
                font: "Arial",
                color: MUTED,
              }),
              ...parseInlineFormatting(el.text, {
                size: 20,
                font: "Arial",
                color: "374151",
              }),
            ],
          })
        );
        break;

      case "hr":
        children.push(
          new Paragraph({
            spacing: { before: 200, after: 200 },
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 2,
                color: BORDER_COLOR,
                space: 1,
              },
            },
            children: [],
          })
        );
        break;

      case "italic":
        children.push(
          new Paragraph({
            spacing: { before: 300, after: 100 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: el.text,
                italics: true,
                size: 20,
                font: "Arial",
                color: MUTED,
              }),
            ],
          })
        );
        break;

      case "paragraph":
        children.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            children: parseInlineFormatting(el.text, {
              size: 22,
              font: "Arial",
              color: "374151",
            }),
          })
        );
        break;
    }
  }

  return new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22 } },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 28, bold: true, font: "Arial" },
          paragraph: {
            spacing: { before: 360, after: 160 },
            outlineLevel: 0,
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 24, bold: true, font: "Arial" },
          paragraph: {
            spacing: { before: 240, after: 120 },
            outlineLevel: 1,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "Photon Brothers \u2014 SOP Questionnaire",
                    size: 16,
                    font: "Arial",
                    color: MUTED,
                    italics: true,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: "Page ",
                    size: 16,
                    font: "Arial",
                    color: MUTED,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    font: "Arial",
                    color: MUTED,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}

function parseInlineFormatting(text, baseStyle) {
  // Handle **bold**, *(italic)*, and (parenthetical hints) in muted color
  const runs = [];
  // Simple regex to split on bold markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          bold: true,
          ...baseStyle,
        })
      );
    } else {
      // Check for parenthetical hints like (phone, email, text, etc.)
      const subParts = part.split(/(\([^)]{10,}\))/g);
      for (const sub of subParts) {
        if (sub.startsWith("(") && sub.endsWith(")") && sub.length > 12) {
          runs.push(
            new TextRun({
              text: sub,
              ...baseStyle,
              color: MUTED,
              size: baseStyle.size - 2,
            })
          );
        } else if (sub.length > 0) {
          runs.push(new TextRun({ text: sub, ...baseStyle }));
        }
      }
    }
  }
  return runs;
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

  for (const file of MD_FILES) {
    const mdPath = path.join(DIR, file);
    if (!fs.existsSync(mdPath)) {
      console.log(`  SKIP ${file} (not found)`);
      continue;
    }

    const content = fs.readFileSync(mdPath, "utf-8");
    const elements = parseMarkdown(content);
    const doc = buildDoc(elements, file);
    const buffer = await Packer.toBuffer(doc);

    const outName = file.replace(".md", ".docx");
    const outPath = path.join(OUT, outName);
    fs.writeFileSync(outPath, buffer);
    console.log(`  + ${outName}`);
  }

  console.log(`\nDone. Files in: ${OUT}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
