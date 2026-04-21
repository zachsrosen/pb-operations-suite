import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!token || token.length < 8) return NextResponse.json({ error: "Invalid token" }, { status: 400 });

  const run = await prisma.estimatorRun.findUnique({
    where: { token },
    select: {
      token: true,
      quoteType: true,
      inputSnapshot: true,
      resultSnapshot: true,
      location: true,
      outOfArea: true,
      manualQuoteRequest: true,
      expiresAt: true,
      createdAt: true,
      firstName: true,
      address: true,
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.expiresAt < new Date()) {
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  return NextResponse.json({
    token: run.token,
    quoteType: run.quoteType,
    input: run.inputSnapshot,
    result: run.resultSnapshot,
    location: run.location,
    outOfArea: run.outOfArea,
    manualQuoteRequest: run.manualQuoteRequest,
    firstName: run.firstName,
    address: run.address,
    createdAt: run.createdAt,
  });
}
