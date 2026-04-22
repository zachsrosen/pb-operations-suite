/**
 * Action: Generate text with Claude.
 *
 * Calls Claude to produce a text output from a prompt + context. The
 * output is written to the step's result so later steps can reference it
 * via `{{previous.<stepId>.text}}`.
 *
 * Example use case:
 *   - AI-compose step generates a personalized email body
 *   - Send-email step uses `{{previous.compose.text}}` as its body
 *
 * Model: Haiku (fast + cheap). Switch to Sonnet by editing CLAUDE_MODELS
 * reference in the handler if you need stronger quality.
 */

import { z } from "zod";

import { getAnthropicClient, CLAUDE_MODELS } from "@/lib/anthropic";
import type { AdminWorkflowAction } from "@/lib/admin-workflows/types";

const inputsSchema = z.object({
  prompt: z.string().min(1),
  maxTokens: z.string().optional().default("500"),
});

export const aiComposeAction: AdminWorkflowAction<
  z.infer<typeof inputsSchema>,
  { text: string; inputTokens: number; outputTokens: number }
> = {
  kind: "ai-compose",
  name: "AI compose text",
  description: "Use Claude Haiku to generate text. Output becomes available to later steps as {{previous.stepId.text}}.",
  category: "AI",
  fields: [
    {
      key: "prompt",
      label: "Prompt",
      kind: "textarea",
      placeholder: "Write a friendly kickoff email to the install crew for deal {{trigger.objectId}}...",
      help: "Supports {{trigger.X}} and {{previous.stepId.field}} templates.",
      required: true,
    },
    {
      key: "maxTokens",
      label: "Max output tokens",
      kind: "text",
      placeholder: "500",
      help: "Roughly 1 token ≈ 4 characters. 500 tokens ≈ one email.",
    },
  ],
  inputsSchema,
  handler: async ({ inputs }) => {
    const client = getAnthropicClient();

    const maxTokens = Math.min(4000, Math.max(32, parseInt(inputs.maxTokens ?? "500", 10) || 500));

    const response = await client.messages.create({
      model: CLAUDE_MODELS.haiku,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: inputs.prompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  },
};
