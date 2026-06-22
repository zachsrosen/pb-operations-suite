"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Inline SOP edit affordance for the Workflow Map Process pane.
 *
 * Reuses the EXISTING SOP write path — `PUT /api/admin/sop/sections/[id]` —
 * which writes a versioned, reversible `SopRevision` and is gated ADMIN ||
 * EXECUTIVE. We do NOT introduce a new write endpoint here. The request body
 * matches `src/components/sop/SopEditor.tsx` exactly:
 *   { content, version, editSummary: editSummary || undefined }
 * and we read `data.version` on success / `data.currentVersion` on 409, the
 * same shape the route returns.
 *
 * SCOPING: this is a deliberately minimal slice — a plain <textarea> editing
 * the section's raw HTML is acceptable for now. The full WYSIWYG editor
 * (TipTap, see SopEditor.tsx) is a future follow-up; the point of this chunk
 * is that edits from the map flow through the existing revision API and stay
 * versioned/reversible.
 *
 * The parent (ProcessPane) only renders this when `canEditSop` is true, but we
 * also defensively render nothing if not editable.
 */
export default function SopEditInline({
  sectionId,
  title,
  content,
  version,
  stageId,
  canEdit = true,
}: {
  sectionId: string;
  title?: string;
  content: string;
  version: number;
  stageId: string;
  /** Defense-in-depth: render nothing if the user can't edit. */
  canEdit?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(content);
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEditor = useCallback(() => {
    // Re-seed from the latest content each time the editor opens.
    setDraft(content);
    setEditSummary("");
    setError(null);
    setOpen(true);
  }, [content]);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft.trim()) {
      setError("Content cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sop/sections/${sectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft,
          version,
          editSummary: editSummary || undefined,
        }),
      });

      if (!res.ok) {
        if (res.status === 409) {
          setError(
            "This section changed since you opened it — reload and retry.",
          );
        } else if (res.status === 403) {
          setError("You don't have permission to edit SOPs.");
        } else {
          let message = "Save failed";
          try {
            const data = await res.json();
            if (data?.error) message = data.error;
          } catch {
            // non-JSON error body — keep generic message
          }
          setError(message);
        }
        return;
      }

      // Success — re-fetch the shared SOP query so the Process pane (and drift
      // badges) re-render with the saved content + bumped version.
      await queryClient.invalidateQueries({
        queryKey: ["workflow-map-sop", stageId],
      });
      setOpen(false);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }, [draft, editSummary, sectionId, version, stageId, queryClient]);

  if (!canEdit) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="text-xs font-medium px-2 py-0.5 rounded text-cyan-400 hover:bg-cyan-500/10 transition-colors"
        title={title ? `Edit: ${title}` : "Edit SOP section"}
      >
        Edit
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-cyan-500/30 bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">
          Editing{title ? `: ${title}` : ""}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted">
          raw HTML · v{version}
        </span>
      </div>

      {error && (
        <div className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400">
          {error}
        </div>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full resize-y rounded border border-t-border bg-surface px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
      />

      <input
        type="text"
        value={editSummary}
        onChange={(e) => setEditSummary(e.target.value)}
        placeholder="Change summary (optional)"
        className="w-full rounded border border-t-border bg-surface px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-cyan-500"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 text-xs font-medium rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={saving}
          className="px-3 py-1 text-xs font-medium rounded bg-surface-2 text-foreground hover:bg-surface border border-t-border transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
