import {
  renderStatusPill,
  renderSectionHeader,
  renderDealRow,
  renderEmailWrapper,
} from "@/lib/daily-focus/html";

describe("renderStatusPill", () => {
  test("renders permit ready status with green pill", () => {
    const html = renderStatusPill("Ready For Permitting", "permitting_status");
    expect(html).toContain("Ready For Permitting");
    expect(html).toContain("background:#dcfce7");
  });

  test("renders resubmit status with amber pill", () => {
    const html = renderStatusPill("Returned from Design", "permitting_status", "pi", "resubmit");
    expect(html).toContain("Revision Ready To Resubmit");
    expect(html).toContain("background:#fef3c7");
  });

  test("renders design revision needed with red pill", () => {
    const html = renderStatusPill("Revision Needed - DA Rejected", "design_status", "design");
    expect(html).toContain("Revision Needed - DA Rejected");
    expect(html).toContain("background:#fee2e2");
  });
});

describe("renderSectionHeader", () => {
  test("renders header bar with correct colors", () => {
    const html = renderSectionHeader("Permits", 5, {
      bg: "#eff6ff",
      border: "#2563eb",
      text: "#2563eb",
    });
    expect(html).toContain("PERMITS");
    expect(html).toContain("(5)");
    expect(html).toContain("background:#eff6ff");
    expect(html).toContain("border-left:3px solid #2563eb");
  });
});

describe("renderDealRow", () => {
  test("renders deal name as hyperlink", () => {
    const html = renderDealRow({
      dealId: "12345",
      dealname: "PROJ-100 | Smith, John | 123 Main St",
      stageName: "Design & Engineering",
      statusDisplay: "Ready For Permitting",
      statusPillHtml: "<span>pill</span>",
      isAlternate: false,
    });
    expect(html).toContain("PROJ-100 | Smith, John");
    expect(html).not.toContain("123 Main St");
    expect(html).toContain("/record/0-3/12345");
    expect(html).toContain("Design &amp; Engineering");
  });
});

describe("renderEmailWrapper", () => {
  test("wraps body in standard email HTML", () => {
    const html = renderEmailWrapper("Test Content");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Content");
    expect(html).toContain("max-width:640px");
  });
});
