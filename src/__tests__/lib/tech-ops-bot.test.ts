// Mock heavy dependencies so the pure buildTechOpsBotSystemPrompt function
// can be tested without pulling in Prisma, Anthropic SDK, or Google Chat API.
jest.mock("@/lib/db", () => ({ prisma: null }));
jest.mock("@/lib/anthropic", () => ({
  getAnthropicClient: jest.fn(),
  CLAUDE_MODELS: { haiku: "claude-haiku-test", sonnet: "claude-sonnet-test" },
}));
jest.mock("@/lib/chat-tools", () => ({ createReadOnlyChatTools: jest.fn(() => []) }));
jest.mock("@/lib/tech-ops-bot-tools", () => ({ createTechOpsBotTools: jest.fn(() => []) }));
jest.mock("@/lib/google-chat-api", () => ({ postGoogleChatMessage: jest.fn() }));
jest.mock("@/lib/review-lock", () => ({}));
jest.mock("@/lib/checks/runner", () => ({}));
jest.mock("@/lib/checks/design-review", () => ({}));
jest.mock("@anthropic-ai/sdk/helpers/beta/zod", () => ({
  betaZodTool: (options: unknown) => options,
}));

import { buildTechOpsBotSystemPrompt } from "@/lib/tech-ops-bot";

describe("buildTechOpsBotSystemPrompt", () => {
  it("includes identity section", () => {
    const prompt = buildTechOpsBotSystemPrompt({
      playbook: "",
      senderName: "Alice",
      senderEmail: "alice@photonbrothers.com",
      spaceDisplayName: "Precon Team",
    });
    expect(prompt).toContain("Zach's AI assistant");
    expect(prompt).toContain("Photon Brothers");
  });

  it("includes playbook when provided", () => {
    const prompt = buildTechOpsBotSystemPrompt({
      playbook: "## Priority: PROJ-1234 is urgent",
      senderName: "Bob",
      senderEmail: "bob@photonbrothers.com",
    });
    expect(prompt).toContain("PROJ-1234 is urgent");
  });

  it("includes sender context", () => {
    const prompt = buildTechOpsBotSystemPrompt({
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
    const prompt = buildTechOpsBotSystemPrompt({
      playbook: "",
      senderName: "Dave",
      senderEmail: "dave@photonbrothers.com",
    });
    expect(prompt).toContain("Direct Message");
  });
});
