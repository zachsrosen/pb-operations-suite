import { verifyGoogleChatJwt } from "@/lib/google-chat-auth";

// Mock jose at module level
jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
  decodeProtectedHeader: jest.fn(() => ({ alg: "RS256", kid: "test-kid" })),
  decodeJwt: jest.fn(() => ({
    iss: "https://accounts.google.com",
    aud: "123456789",
    sub: "user",
  })),
}));

import { jwtVerify } from "jose";
const mockJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

describe("verifyGoogleChatJwt", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, GOOGLE_CHAT_PROJECT_NUMBER: "123456789" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns payload on valid JWT", async () => {
    const mockPayload = {
      iss: "chat@system.gserviceaccount.com",
      aud: "123456789",
      email: "user@photonbrothers.com",
    };
    mockJwtVerify.mockResolvedValueOnce({
      payload: mockPayload,
      protectedHeader: { alg: "RS256" },
    } as never);

    const result = await verifyGoogleChatJwt("Bearer fake-jwt-token");
    expect(result).toEqual({ valid: true, payload: mockPayload });
  });

  it("returns invalid when no auth header", async () => {
    const result = await verifyGoogleChatJwt(null);
    expect(result).toEqual({ valid: false, error: "Missing authorization header" });
  });

  it("returns invalid when auth header missing Bearer prefix", async () => {
    const result = await verifyGoogleChatJwt("Basic abc123");
    expect(result).toEqual({ valid: false, error: "Missing authorization header" });
  });

  it("returns invalid when JWT verification fails across all sources", async () => {
    // All JWKS source/issuer attempts reject
    mockJwtVerify.mockRejectedValue(new Error("JWT expired"));
    const result = await verifyGoogleChatJwt("Bearer expired-token");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("JWT expired");
    }
  });

  it("succeeds via a fallback JWKS source (OAuth2)", async () => {
    const mockPayload = {
      iss: "https://accounts.google.com",
      aud: "123456789",
      email: "user@photonbrothers.com",
    };
    // First source fails, second (OAuth2) succeeds
    mockJwtVerify
      .mockRejectedValueOnce(new Error("no applicable key found"))
      .mockResolvedValueOnce({
        payload: mockPayload,
        protectedHeader: { alg: "RS256" },
      } as never);

    const result = await verifyGoogleChatJwt("Bearer fallback-token");
    expect(result).toEqual({ valid: true, payload: mockPayload });
  });

  it("returns invalid when GOOGLE_CHAT_PROJECT_NUMBER is missing", async () => {
    delete process.env.GOOGLE_CHAT_PROJECT_NUMBER;
    const result = await verifyGoogleChatJwt("Bearer some-token");
    expect(result).toEqual({ valid: false, error: "GOOGLE_CHAT_PROJECT_NUMBER not configured" });
  });
});
