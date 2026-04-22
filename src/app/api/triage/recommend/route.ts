import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { listAdders } from "@/lib/adders/catalog";
import { recommendAdders } from "@/lib/adders/triage";

const RecommendInputSchema = z.object({
  shop: z.string().min(1),
  answers: z.record(z.string(), z.unknown()).default({}),
  dealContext: z
    .object({
      dealType: z.string().optional(),
      valueCents: z.number().optional(),
    })
    .optional(),
});

/**
 * POST /api/triage/recommend
 * Stateless: given a shop + current answer map, return recommended adders
 * (with shop-resolved pricing + signed amount). Does NOT persist anything —
 * callers may call this repeatedly while the user is answering questions.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RecommendInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const adders = await listAdders({ active: true });
  const recommendations = recommendAdders({
    adders,
    answers: parsed.data.answers,
    shop: parsed.data.shop,
    dealContext: parsed.data.dealContext,
  });

  return NextResponse.json({ recommendations });
}
