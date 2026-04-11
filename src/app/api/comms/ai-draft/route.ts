import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { generateAiDraft } from "@/lib/comms-ai-draft";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const { originalFrom, originalSubject, originalSnippet, threadSnippets, voiceProfile, customInstructions } = body;

  if (!originalFrom || !originalSubject) {
    return NextResponse.json({ error: "originalFrom and originalSubject are required" }, { status: 400 });
  }

  const result = await generateAiDraft({
    originalFrom,
    originalSubject,
    originalSnippet: originalSnippet || "",
    threadSnippets,
    voiceProfile,
    customInstructions,
  });

  return NextResponse.json(result);
}
