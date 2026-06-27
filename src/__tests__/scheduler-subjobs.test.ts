import { zuperJobUrl } from "@/lib/scheduler-subjobs";

describe("zuperJobUrl", () => {
  it("builds a Zuper job details URL", () => {
    expect(zuperJobUrl("https://web.zuperpro.com", "abc-123")).toBe(
      "https://web.zuperpro.com/jobs/abc-123/details",
    );
  });

  it("trims a trailing slash on the base URL", () => {
    expect(zuperJobUrl("https://web.zuperpro.com/", "abc-123")).toBe(
      "https://web.zuperpro.com/jobs/abc-123/details",
    );
  });
});
