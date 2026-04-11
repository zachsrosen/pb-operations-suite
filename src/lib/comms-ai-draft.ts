/**
 * AI-assisted draft generation for Comms.
 * Claude primary, Gemini fallback.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface DraftContext {
  originalFrom: string;
  originalSubject: string;
  originalSnippet: string;
  threadSnippets?: string[];
  voiceProfile?: string; // "sales" | "ops" | "executive" | "casual"
  customInstructions?: string;
}

interface GeneratedDraft {
  body: string;
  provider: "claude" | "gemini" | "template";
}

async function generateWithClaude(
  context: DraftContext
): Promise<GeneratedDraft | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You are drafting a professional email reply for a solar operations company (Photon Brothers). Voice: ${context.voiceProfile || "professional"}. Be concise and direct. Do not include a subject line — only the email body.${context.customInstructions ? ` Additional instructions: ${context.customInstructions}` : ""}`;

  const threadContext = context.threadSnippets?.length
    ? `\n\nThread context:\n${context.threadSnippets.slice(0, 3).join("\n---\n")}`
    : "";

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Draft a reply to this email:\n\nFrom: ${context.originalFrom}\nSubject: ${context.originalSubject}\nBody: ${context.originalSnippet}${threadContext}`,
        },
      ],
    }),
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  const text = data.content?.[0]?.text;
  if (!text) return null;

  return { body: text, provider: "claude" };
}

async function generateWithGemini(
  context: DraftContext
): Promise<GeneratedDraft | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL || "gemini-1.5-pro-latest";
  const prompt = `Draft a professional email reply for a solar operations company (Photon Brothers). Voice: ${context.voiceProfile || "professional"}.${context.customInstructions ? ` ${context.customInstructions}` : ""}\n\nOriginal email:\nFrom: ${context.originalFrom}\nSubject: ${context.originalSubject}\nBody: ${context.originalSnippet}\n\nWrite only the email body, no subject line.`;

  const resp = await fetch(
    `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!resp.ok) return null;

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  return { body: text, provider: "gemini" };
}

export async function generateAiDraft(
  context: DraftContext
): Promise<GeneratedDraft> {
  // Claude primary, Gemini fallback
  const claudeResult = await generateWithClaude(context);
  if (claudeResult) return claudeResult;

  const geminiResult = await generateWithGemini(context);
  if (geminiResult) return geminiResult;

  return {
    body: `Hi,\n\nThank you for your email regarding "${context.originalSubject}". I'll review and get back to you shortly.\n\nBest,`,
    provider: "template", // neither AI provider available
  };
}
