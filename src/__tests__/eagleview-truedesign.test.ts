/**
 * Unit tests for the pure TrueDesign helpers (PKCE + export URL building).
 * The OAuth/token/network functions are integration-tested after the one-time
 * login; these cover the deterministic logic.
 */
import {
  generateCodeVerifier,
  codeChallengeS256,
  buildExportEndpoint,
  buildAuthorizeUrl,
  TRUEDESIGN_FORMATS,
} from "@/lib/eagleview-truedesign-core";

describe("TrueDesign PKCE", () => {
  it("generates a URL-safe verifier of adequate length", () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a stable S256 challenge (RFC 7636 test vector)", () => {
    // RFC 7636 Appendix B verifier → challenge.
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("TrueDesign export endpoint", () => {
  it("builds the export path per format", () => {
    expect(buildExportEndpoint("dxf", "71587722", "abc-123")).toBe(
      "https://solar-api.eagleview.com/api/v1/truedesign/export/dxf/71587722/abc-123",
    );
    expect(buildExportEndpoint("pdf", "71587722", "abc-123")).toContain("/export/pdf/71587722/abc-123");
  });

  it("maps each format to a distinct Drive column + extension", () => {
    expect(TRUEDESIGN_FORMATS.dxf.column).toBe("dxfDriveFileId");
    expect(TRUEDESIGN_FORMATS.dwg.column).toBe("dwgDriveFileId");
    expect(TRUEDESIGN_FORMATS.pdf.column).toBe("designPdfDriveFileId");
    expect(TRUEDESIGN_FORMATS.dxf.ext).toBe("dxf");
  });
});

describe("TrueDesign authorize URL", () => {
  it("includes PKCE + offline_access params with the passed client id", () => {
    const u = new URL(
      buildAuthorizeUrl("https://pbtechops.com/cb", "challenge123", "state123", "test-client"),
    );
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("test-client");
    expect(u.searchParams.get("redirect_uri")).toBe("https://pbtechops.com/cb");
    expect(u.searchParams.get("code_challenge")).toBe("challenge123");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toContain("offline_access");
  });

  it("throws when no client id is configured", () => {
    expect(() =>
      buildAuthorizeUrl("https://pbtechops.com/cb", "c", "s", undefined),
    ).toThrow(/client id not configured/);
  });
});
