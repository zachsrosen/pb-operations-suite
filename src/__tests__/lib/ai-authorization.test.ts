/**
 * Tests for AI role authorization.
 *
 * The ai.ts module imports @ai-sdk/openai which requires TransformStream
 * (unavailable in Jest's Node env), so we cannot import isAIAuthorized
 * directly. Instead we use jest.mock to stub the dependency and isolate
 * the role guard logic.
 */

jest.mock("@ai-sdk/openai", () => ({ createOpenAI: jest.fn() }));

import { isAIAuthorized } from "@/lib/ai";

describe("isAIAuthorized", () => {
  const ALLOWED = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];
  const DENIED = [
    "OPERATIONS",
    "TECH_OPS",
    "SALES",
    "VIEWER",
    "DESIGNER",
    "PERMITTING",
    "MANAGER",
  ];

  it.each(ALLOWED)("allows %s to use AI features", (role) => {
    expect(isAIAuthorized(role)).toBe(true);
  });

  it.each(DENIED)("denies %s from AI features", (role) => {
    expect(isAIAuthorized(role)).toBe(false);
  });
});
