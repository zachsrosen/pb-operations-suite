// Mock heavy dependencies so the pure buildOooBotSystemPrompt function
// can be tested without pulling in Prisma, Anthropic SDK, or Google Chat API.
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/anthropic", () => ({
  getAnthropicClient: jest.fn(),
  CLAUDE_MODELS: { haiku: "claude-haiku-test", sonnet: "claude-sonnet-test" },
}));
jest.mock("@/lib/chat-tools", () => ({ createReadOnlyChatTools: jest.fn(() => []) }));
jest.mock("@/lib/ooo-bot-tools", () => ({ createOooBotTools: jest.fn(() => []) }));
jest.mock("@/lib/google-chat-api", () => ({ postGoogleChatMessage: jest.fn() }));
jest.mock("@/lib/review-lock", () => ({}));
jest.mock("@/lib/checks/runner", () => ({}));
jest.mock("@/lib/checks/design-review", () => ({}));
jest.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (options: unknown) => options,
}));

import { buildOooBotSystemPrompt } from "@/lib/ooo-bot";

describe("buildOooBotSystemPrompt", () => {
  it("includes identity section", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "",
      senderName: "Alice",
      senderEmail: "alice@photonbrothers.com",
      spaceDisplayName: "Precon Team",
    });
    expect(prompt).toContain("Zach's AI assistant");
    expect(prompt).toContain("Photon Brothers");
  });

  it("includes playbook when provided", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "## Priority: PROJ-1234 is urgent",
      senderName: "Bob",
      senderEmail: "bob@photonbrothers.com",
    });
    expect(prompt).toContain("PROJ-1234 is urgent");
  });

  it("includes sender context", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "",
      senderName: "Carol",
      senderEmail: "carol@photonbrothers.com",
      spaceDisplayName: "Test Space",
    });
    expect(prompt).toContain("Carol");
    expect(prompt).toContain("carol@photonbrothers.com");
    expect(prompt).toContain("Test Space");
  });

  it("shows Direct Message when no space name", () => {
    const prompt = buildOooBotSystemPrompt({
      playbook: "",
      senderName: "Dave",
      senderEmail: "dave@photonbrothers.com",
    });
    expect(prompt).toContain("Direct Message");
  });
});
