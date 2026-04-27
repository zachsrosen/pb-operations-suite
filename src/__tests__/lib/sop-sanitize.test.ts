import { autolinkRoutes, sanitizeSopContent } from "@/lib/sop-sanitize";

describe("autolinkRoutes", () => {
  it("auto-links dashboard route refs", () => {
    const out = autolinkRoutes("<p>Open <code>/dashboards/revenue</code> for details.</p>");
    expect(out).toContain('href="/dashboards/revenue"');
    expect(out).toContain('data-sop-link="auto"');
    expect(out).toContain("<code>/dashboards/revenue</code>");
  });

  it("auto-links sop tab refs", () => {
    const out = autolinkRoutes("Cross-ref to <code>/sop?tab=service</code>.");
    expect(out).toContain('href="/sop?tab=service"');
  });

  it("auto-links suite refs", () => {
    const out = autolinkRoutes("<code>/suites/operations</code>");
    expect(out).toContain('href="/suites/operations"');
  });

  it("auto-links admin refs", () => {
    const out = autolinkRoutes("<code>/admin</code>");
    expect(out).toContain('href="/admin"');
  });

  it("auto-links estimator + triage refs", () => {
    const a = autolinkRoutes("<code>/estimator/new-install</code>");
    expect(a).toContain('href="/estimator/new-install"');
    const b = autolinkRoutes("<code>/triage</code>");
    expect(b).toContain('href="/triage"');
  });

  it("does NOT link /api/* paths (they're documentation, not navigable pages)", () => {
    const out = autolinkRoutes("<code>/api/sop/tabs</code>");
    expect(out).not.toContain('href="/api/sop/tabs"');
    expect(out).toContain("<code>/api/sop/tabs</code>");
  });

  it("does NOT link arbitrary code snippets without a recognized prefix", () => {
    const out = autolinkRoutes("<code>const x = 1</code>");
    expect(out).not.toContain("<a");
  });

  it("does NOT link relative paths like ../foo", () => {
    const out = autolinkRoutes("<code>../foo/bar</code>");
    expect(out).not.toContain("<a");
  });

  it("is idempotent — leaves already-anchored <code> alone", () => {
    const input =
      '<a href="/dashboards/revenue" data-sop-link="auto" class="sop-route-link"><code>/dashboards/revenue</code></a>';
    const out = autolinkRoutes(input);
    // No double-wrapping
    const anchorCount = (out.match(/<a /g) || []).length;
    expect(anchorCount).toBe(1);
  });

  it("does NOT link documentation placeholders with HTML-entity angle brackets", () => {
    const out = autolinkRoutes("<code>/sop?tab=&lt;tabId&gt;</code>");
    expect(out).not.toContain("<a");
  });

  it("handles multiple route refs in one block", () => {
    const out = autolinkRoutes(
      "<ul><li><code>/dashboards/revenue</code></li><li><code>/dashboards/capacity</code></li></ul>",
    );
    const anchors = (out.match(/<a /g) || []).length;
    expect(anchors).toBe(2);
  });
});

describe("sanitizeSopContent — autolink integration", () => {
  it("preserves the data-sop-link attribute through sanitization", () => {
    const html = "<p>See <code>/dashboards/bom</code>.</p>";
    const out = sanitizeSopContent(html);
    expect(out).toContain('data-sop-link="auto"');
    // Same-tab nav (no target=_blank)
    expect(out).not.toContain('target="_blank"');
  });

  it("preserves the sop-route-link class through sanitization", () => {
    const html = "<code>/sop?tab=service</code>";
    const out = sanitizeSopContent(html);
    expect(out).toContain("sop-route-link");
  });

  it("strips scripts even when wrapped in <code>", () => {
    const out = sanitizeSopContent('<code>/dashboards/x</code><script>alert(1)</script>');
    expect(out).not.toContain("<script");
  });
});
