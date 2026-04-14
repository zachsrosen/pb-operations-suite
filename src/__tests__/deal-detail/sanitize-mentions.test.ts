import { sanitizeEngagementHtml } from "@/lib/sanitize-engagement-html";

describe("sanitizeEngagementHtml — @mention stripping", () => {
  it("converts @mention links to plain spans", () => {
    const input = '<p>Hey <a href="https://app.hubspot.com/contacts/123" data-type="mention">@John Doe</a>, please review.</p>';
    const result = sanitizeEngagementHtml(input);
    expect(result).not.toContain("<a");
    expect(result).toContain("<span>@John Doe</span>");
    expect(result).toContain("please review");
  });

  it("preserves normal links with target and rel", () => {
    const input = '<p>See <a href="https://example.com">this link</a></p>';
    const result = sanitizeEngagementHtml(input);
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("handles mixed content with both mentions and links", () => {
    const input = '<p><a data-type="mention">@Alice</a> shared <a href="https://example.com">a doc</a></p>';
    const result = sanitizeEngagementHtml(input);
    expect(result).toContain("<span>@Alice</span>");
    expect(result).toContain('<a href="https://example.com"');
  });

  it("returns empty string for null input", () => {
    expect(sanitizeEngagementHtml(null)).toBe("");
    expect(sanitizeEngagementHtml(undefined)).toBe("");
  });
});
