"use client";

import { useState, useCallback } from "react";

interface NoteComposerProps {
  dealId: string;
  onNoteCreated: () => void;
}

export default function NoteComposer({ dealId, onNoteCreated }: NoteComposerProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (res.ok) {
        setContent("");
        onNoteCreated();
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setSubmitting(false);
    }
  }, [content, dealId, submitting, onNoteCreated]);

  const remaining = 5000 - content.length;

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50 p-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add a note..."
        maxLength={5000}
        rows={2}
        className="w-full resize-none rounded border border-t-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className={`text-[10px] ${remaining < 200 ? "text-orange-500" : "text-muted"}`}>
          {remaining < 500 ? `${remaining} characters remaining` : ""}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || submitting}
          className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Adding..." : "Add Note"}
        </button>
      </div>
    </div>
  );
}
