/**
 * Anthropic Claude Client
 *
 * Lazy-initialized Anthropic SDK client for the chat widget.
 * Throws at call-time (not import-time) so missing env doesn't
 * crash cold starts for non-AI routes.
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-5-20250929",
} as const;
