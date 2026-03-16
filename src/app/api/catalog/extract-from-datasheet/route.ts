import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { FORM_CATEGORIES, CATEGORY_CONFIGS, type FieldDef } from "@/lib/catalog-fields";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { matchVendorName } from "@/lib/vendor-normalize";

// Import pdf-parse/lib directly — the main index.js has a bug that tries
// to read a test file on import when module.parent is falsy (serverless/ESM).
async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js" as any)).default;
  const data = await pdfParse(buffer);
  return data.text;
}

/** Build a JSON-schema properties block from category field definitions. */
function buildSpecProperties(fields: FieldDef[]): Record<string, object> {
  const props: Record<string, object> = {};
  for (const f of fields) {
    if (f.type === "number") {
      props[f.key] = {
        type: "number",
        description: `${f.label}${f.unit ? ` (${f.unit})` : ""}${f.tooltip ? ` — ${f.tooltip}` : ""}`,
      };
    } else if (f.type === "dropdown" && f.options?.length) {
      props[f.key] = {
        type: "string",
        enum: f.options,
        description: `${f.label}${f.tooltip ? ` — ${f.tooltip}` : ""}`,
      };
    } else if (f.type === "toggle") {
      props[f.key] = {
        type: "boolean",
        description: `${f.label}${f.tooltip ? ` — ${f.tooltip}` : ""}`,
      };
    } else {
      props[f.key] = {
        type: "string",
        description: `${f.label}${f.unit ? ` (${f.unit})` : ""}${f.tooltip ? ` — ${f.tooltip}` : ""}`,
      };
    }
  }
  return props;
}

/** Build the extraction tool schema, optionally enriched with category-specific fields. */
function buildExtractionTool(categoryHint?: string) {
  const categoryFields = categoryHint ? CATEGORY_CONFIGS[categoryHint]?.fields : undefined;

  // Build specValues schema — if we know the category, enumerate all expected fields
  const specValuesSchema: Record<string, unknown> = categoryFields?.length
    ? {
        type: "object",
        properties: buildSpecProperties(categoryFields),
        description: `Category-specific spec fields. Extract ALL values you can find in the datasheet.`,
      }
    : {
        type: "object",
        description: "Category-specific specs. Keys: wattage, efficiency, cellType, capacity, acOutputSize, etc.",
      };

  return {
    name: "extract_product_info",
    description: "Extract structured solar equipment product information from text",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: FORM_CATEGORIES,
          description: "Product category",
        },
        brand: { type: "string", description: "Manufacturer/brand name" },
        model: { type: "string", description: "Model number or part number" },
        description: { type: "string", description: "Short product description (1-2 sentences)" },
        unitSpec: { type: "string", description: "Primary numeric spec value (e.g. '400' for 400W module, '13.5' for 13.5kWh battery)" },
        unitLabel: { type: "string", description: "Unit for the spec (e.g. 'W', 'kWh', 'kW', 'A')" },
        sku: { type: "string", description: "SKU or part number if different from model" },
        specValues: specValuesSchema,
      },
      required: ["brand", "model"],
    },
  };
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "AI extraction not configured" }, { status: 503 });
  }

  let text: string;
  let categoryHint: string | undefined;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    const cat = formData.get("category");
    if (cat && typeof cat === "string" && CATEGORY_CONFIGS[cat]) {
      categoryHint = cat;
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 10MB" }, { status: 400 });
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      text = await extractPdfText(buffer);
    } catch {
      return NextResponse.json(
        { error: "Could not read PDF. Try pasting specs as text instead." },
        { status: 422 }
      );
    }
  } else {
    const body = await request.json();
    text = body.text;
    if (body.category && typeof body.category === "string" && CATEGORY_CONFIGS[body.category]) {
      categoryHint = body.category;
    }
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return NextResponse.json({ error: "Text too short to extract from" }, { status: 400 });
    }
  }

  // Truncate to ~8000 chars to stay within reasonable token limits
  const truncated = text.slice(0, 8000);

  // Build category-aware prompt
  const categoryLabel = categoryHint ? CATEGORY_CONFIGS[categoryHint]?.label : undefined;
  const categoryFields = categoryHint ? CATEGORY_CONFIGS[categoryHint]?.fields : undefined;

  let fieldGuide: string;
  if (categoryFields?.length) {
    // Specific category — list its fields
    const fieldList = categoryFields
      .map((f) => `- ${f.key}: ${f.label}${f.unit ? ` (${f.unit})` : ""}`)
      .join("\n");
    fieldGuide = `\nExtract ALL of the following spec fields into specValues if found in the text:\n${fieldList}\n`;
  } else {
    // No category hint — list all major categories' fields so AI can auto-detect
    const allGuides: string[] = [];
    for (const [cat, config] of Object.entries(CATEGORY_CONFIGS)) {
      if (!config.fields.length) continue;
      const fields = config.fields.map((f) => `${f.key}${f.unit ? ` (${f.unit})` : ""}`).join(", ");
      allGuides.push(`${cat} (${config.label}): ${fields}`);
    }
    fieldGuide = `\nFirst determine the product category, then extract ALL relevant spec fields into specValues. Here are the fields by category:\n${allGuides.join("\n")}\n`;
  }

  const promptParts = [
    `Extract solar equipment product information from this datasheet text.`,
    categoryLabel ? `This is a ${categoryLabel} product.` : null,
    fieldGuide,
    `Extract as many fields as possible — be thorough. Include numeric values as numbers (not strings). For the primary spec (unitSpec), extract the main rated value (e.g. wattage for modules, kWh for batteries, kW for inverters).`,
    `\nDatasheet text:\n${truncated}`,
  ].filter(Boolean).join("\n");

  const tool = buildExtractionTool(categoryHint);

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: "tool", name: "extract_product_info" },
      messages: [{ role: "user", content: promptParts }],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      return NextResponse.json({ error: "Could not extract product information" }, { status: 422 });
    }

    const extracted = toolBlock.input as Record<string, unknown>;

    // Attempt vendor matching if AI extracted a vendor
    const extractedVendor = extracted.vendorName as string | undefined;
    if (extractedVendor && prisma) {
      const lookups = await prisma.vendorLookup.findMany({
        where: { isActive: true },
        select: { zohoVendorId: true, name: true },
      });
      const match = matchVendorName(extractedVendor, lookups);
      if (match) {
        extracted.vendorName = match.name;
        extracted.zohoVendorId = match.zohoVendorId;
      } else {
        // Keep as hint, no zohoVendorId — user must pick manually
        extracted.vendorHint = extractedVendor;
        delete extracted.vendorName;
      }
    }

    // Count extracted fields (top-level + specValues)
    const specValues = extracted.specValues as Record<string, unknown> | undefined;
    const topLevelCount = Object.entries(extracted).filter(
      ([k, v]) => k !== "specValues" && v !== undefined && v !== null && v !== ""
    ).length;
    const specCount = specValues
      ? Object.values(specValues).filter((v) => v !== undefined && v !== null && v !== "").length
      : 0;
    const fieldCount = topLevelCount + specCount;
    // Compute totalFields from the detected or hinted category
    const detectedCategory = (extracted.category as string) || categoryHint;
    const detectedFields = detectedCategory ? CATEGORY_CONFIGS[detectedCategory]?.fields : undefined;
    const totalFields = 6 + (detectedFields?.length ?? categoryFields?.length ?? 0);

    return NextResponse.json({ ...extracted, fieldCount, totalFields });
  } catch (err) {
    console.error("[catalog] Datasheet extraction failed:", err);
    return NextResponse.json(
      { error: "AI extraction failed. Try pasting specs as text instead." },
      { status: 500 }
    );
  }
}
