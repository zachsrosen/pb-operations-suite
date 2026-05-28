// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock crypto.createSign to avoid real RSA signing with dummy key
const mockSign = {
  update: jest.fn(),
  end: jest.fn(),
  sign: jest.fn().mockReturnValue("mock-signature"),
};
jest.mock("crypto", () => ({
  ...jest.requireActual("crypto"),
  createSign: jest.fn(() => mockSign),
}));

describe("postGoogleChatMessage", () => {
  const ORIGINAL_ENV = process.env;

  let postGoogleChatMessage: typeof import("@/lib/google-chat-api").postGoogleChatMessage;

  beforeEach(() => {
    jest.resetModules();
    mockFetch.mockReset();
    process.env = {
      ...ORIGINAL_ENV,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "bot@project.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
    };
    // Re-require after resetModules to clear the module-level token cache
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    postGoogleChatMessage = require("@/lib/google-chat-api").postGoogleChatMessage;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("posts message to correct URL with thread", async () => {
    // Mock token fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "test-token" }),
    });
    // Mock message post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ name: "spaces/xxx/messages/yyy" }),
    });

    await postGoogleChatMessage({
      spaceName: "spaces/abc123",
      threadName: "spaces/abc123/threads/def456",
      text: "Hello from bot",
    });

    // Second fetch call is the message post
    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toContain("spaces/abc123/messages");
    expect(url).toContain("messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.text).toBe("Hello from bot");
    expect(body.thread.name).toBe("spaces/abc123/threads/def456");
  });

  it("throws when service account not configured", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    await expect(
      postGoogleChatMessage({
        spaceName: "spaces/x",
        text: "Hi",
      })
    ).rejects.toThrow("Google service account not configured");
  });
});
