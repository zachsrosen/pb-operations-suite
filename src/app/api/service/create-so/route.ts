import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { createServiceSo } from "@/lib/service-so-create";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { dealId, dealName, dealAddress, requestToken, items } = body;

    if (!dealId || !requestToken || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "dealId, requestToken, and items[] are required" },
        { status: 400 }
      );
    }

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== "number" || item.quantity < 1) {
        return NextResponse.json(
          { error: "Each item must have productId and quantity >= 1" },
          { status: 400 }
        );
      }
    }

    const result = await createServiceSo({
      dealId: String(dealId),
      dealName: dealName || "",
      dealAddress: dealAddress || "",
      requestToken,
      items,
      createdBy: authResult.email,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[CreateServiceSO] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to create service SO";
    const status = message.includes("must have an associated company") ? 400
      : message.includes("not valid SERVICE products") ? 400
      : message.includes("already in progress") ? 409
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
