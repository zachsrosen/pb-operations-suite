import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";
import { requireApiAuth } from "@/lib/api-auth";

// pdf-parse v2: pass { data } to constructor, then load() → getText()
async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PDFParse } = await import("pdf-parse") as any;
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  await parser.load();
  return parser.getText();
}

const EXTRACTION_TOOL = {
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
      description: { type: "string", description: "Short product description" },
      unitSpec: { type: "string", description: "Primary numeric spec value (e.g. '400' for 400W module)" },
      unitLabel: { type: "string", description: "Unit for the spec (e.g. 'W', 'kWh', 'kW', 'A')" },
      specValues: {
        type: "object",
        description: "Category-specific specs. Keys: wattage, efficiency, cellType, capacity, acOutputSize, etc.",
      },
    },
    required: ["brand", "model"],
  },
};

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "AI extraction not configured" }, { status: 503 });
  }

  let text: string;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
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
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return NextResponse.json({ error: "Text too short to extract from" }, { status: 400 });
    }
  }

  // Truncate to ~8000 chars to stay within reasonable token limits
  const truncated = text.slice(0, 8000);

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_product_info" },
      messages: [
        {
          role: "user",
          content: `Extract solar equipment product information from this text. Only include fields you are confident about — leave out anything uncertain.\n\n${truncated}`,
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      return NextResponse.json({ error: "Could not extract product information" }, { status: 422 });
    }

    const extracted = toolBlock.input as Record<string, unknown>;

    // Count fields for confidence banner
    const fieldCount = Object.values(extracted).filter(
      (v) => v !== undefined && v !== null && v !== ""
    ).length;

    return NextResponse.json({ ...extracted, fieldCount, totalFields: 18 });
  } catch (err) {
    console.error("[catalog] Datasheet extraction failed:", err);
    return NextResponse.json(
      { error: "AI extraction failed. Try pasting specs as text instead." },
      { status: 500 }
    );
  }
}
