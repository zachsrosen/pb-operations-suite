"use client";

import { sanitizeSopContent } from "@/lib/sop-sanitize";
import "@/app/sop/sop-content.css";
import type { SopSectionContent } from "./useStageSop";

/**
 * Process pane — renders the SOP sections that document a stage's automation.
 *
 * Receives the SOP query result as props (lifted into StagePanes via
 * `useStageSop`) so it shares one fetch with DriftBadges. Section HTML is
 * sanitized with the same `sanitizeSopContent` helper + `.sop-content` styles
 * that `/sop` uses (sanitize-html with an attribute/tag allowlist) — never
 * rendered raw.
 */
export default function ProcessPane({
  sections,
  projectOnly,
  isLoading,
}: {
  sections: SopSectionContent[];
  projectOnly: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-t-border bg-surface-2/40 p-4 text-sm text-muted">
        Loading SOP process…
      </div>
    );
  }

  // Stage isn't in the Project-pipeline SOP map.
  if (!projectOnly) {
    return (
      <div className="rounded-lg border border-dashed border-t-border bg-surface-2/40 p-4 text-sm text-muted">
        SOP process is documented for the Project pipeline in this version.
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-t-border bg-surface-2/40 p-4 text-sm text-muted">
        No SOP section mapped yet.
      </div>
    );
  }

  return (
    <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-t-border bg-surface p-4 shadow-card">
      {sections.map((section) => (
        <div
          key={section.id}
          className="sop-content"
          // Sanitized via sanitizeSopContent (sanitize-html allowlist), same as /sop.
          dangerouslySetInnerHTML={{
            __html: sanitizeSopContent(section.content),
          }}
        />
      ))}
    </div>
  );
}
