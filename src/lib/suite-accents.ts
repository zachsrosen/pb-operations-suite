export interface SuiteAccent {
  color: string;
  light: string;
}

export const SUITE_ACCENT_COLORS: Record<string, SuiteAccent> = {
  "/suites/operations":                 { color: "#f97316", light: "#fb923c" },
  "/suites/design-engineering":         { color: "#6366f1", light: "#818cf8" },
  "/suites/permitting-interconnection": { color: "#06b6d4", light: "#22d3ee" },
  "/suites/service":                    { color: "#06b6d4", light: "#22d3ee" },
  "/suites/dnr-roofing":                { color: "#a855f7", light: "#c084fc" },
  "/suites/intelligence":               { color: "#3b82f6", light: "#60a5fa" },
  "/suites/executive":                  { color: "#f59e0b", light: "#fbbf24" },
  "/suites/admin":                      { color: "#f97316", light: "#fb923c" },
};

export const DEFAULT_SUITE_ACCENT: SuiteAccent = { color: "#f97316", light: "#fb923c" };
