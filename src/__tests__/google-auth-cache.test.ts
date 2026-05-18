/**
 * Tests for getServiceAccountToken token caching.
 *
 * The SUT mints + caches Google OAuth access tokens. We mock the
 * `fetch` -> oauth2.googleapis.com path to count mint calls.
 */

import { getServiceAccountToken, _resetTokenCacheForTests } from "@/lib/google-auth";

const ORIG_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const ORIG_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

// A throwaway PEM that's syntactically valid; signature isn't verified by the
// fetch mock so any text after BEGIN/END is fine.
const FAKE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu
KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIJLixBy2qpFoS4DSmoEm
o3qGy0t6z09AIJtH+5OeRV1be+N4cDYJKffGzDA+mXAImY56ZegEt0RPgYBnQYUk
yQIhAPLp1iMcukmtR9HKmUbuIRT0bbAW6mNRgU0jq0kjB6+VAiEAxlpoxq8e6oTL
+wzGmEf8w0njQAj/CITS6Zr3CagsoVECIQDLkRiHALhWnDuoJINEcS5DD3LFOG/c
WTeyhfXY+rNGqQIgMyOcXxsVfQrnsRMTBC3a/eyOoBdc9rEDIzlmrm5MyQECIDpu
fA9rIIo65hO9aOJxn1pMr0PYz4U23s/xZWcSXr3O
-----END RSA PRIVATE KEY-----`;

const mockFetch = jest.fn();

beforeAll(() => {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test-sa@test.iam.gserviceaccount.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = FAKE_KEY;
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = ORIG_EMAIL;
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = ORIG_KEY;
});

beforeEach(() => {
  _resetTokenCacheForTests();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () =>
    new Response(JSON.stringify({ access_token: "tok-" + Math.random().toString(36).slice(2, 8) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

describe("getServiceAccountToken caching", () => {
  it("caches the token across sequential calls with the same scope+impersonate", async () => {
    const a = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
    const b = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
    expect(a).toBe(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent cache misses to a single mint", async () => {
    const [a, b, c] = await Promise.all([
      getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]),
      getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]),
      getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("mints separately for different scope sets", async () => {
    const a = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"]);
    const b = await getServiceAccountToken(["https://www.googleapis.com/auth/drive"]);
    expect(a).not.toBe(b);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("mints separately for different impersonateEmail", async () => {
    const a = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"], "a@x.com");
    const b = await getServiceAccountToken(["https://www.googleapis.com/auth/drive.readonly"], "b@x.com");
    expect(a).not.toBe(b);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("normalises scope order — ['a','b'] and ['b','a'] hit the same cache slot", async () => {
    const a = await getServiceAccountToken(["scope-a", "scope-b"]);
    const b = await getServiceAccountToken(["scope-b", "scope-a"]);
    expect(a).toBe(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
