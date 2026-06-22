"use client";

import { useQuery } from "@tanstack/react-query";

export type SopSectionContent = { id: string; content: string };

export type StageSopResponse = {
  sections: SopSectionContent[];
  /** true when the stage is mapped to SOP sections (Project pipeline). */
  projectOnly: boolean;
};

/**
 * Shared SOP fetch for a stage. Both ProcessPane (renders the HTML) and
 * DriftBadges (diffs the HTML against live flows) need the same section
 * contents, so the query is lifted here and consumed once in StagePanes —
 * a single network request feeds both surfaces.
 */
export function useStageSop(stageId: string) {
  return useQuery<StageSopResponse>({
    queryKey: ["workflow-map-sop", stageId],
    queryFn: () =>
      fetch(`/api/workflow-map/sop/${encodeURIComponent(stageId)}`).then((r) =>
        r.json(),
      ),
  });
}
