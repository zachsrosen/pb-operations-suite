import { SITE_SURVEY_FOLDER_PATTERNS } from "@/lib/drive-plansets";

describe("SITE_SURVEY_FOLDER_PATTERNS", () => {
  const matches = (name: string) =>
    SITE_SURVEY_FOLDER_PATTERNS.some((p) => p.test(name));

  it.each([
    "Site Survey",
    "1. Site Survey",
    "Site Survey - CA",
    "site survey",
    "SiteSurvey",
    "SS",
  ])("matches %s", (name) => {
    expect(matches(name)).toBe(true);
  });

  it.each(["Design", "Stamped Plans", "2. Design", "DA", "Construction"])(
    "does not match %s",
    (name) => {
      expect(matches(name)).toBe(false);
    },
  );
});
