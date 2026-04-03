"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import type { IdrItem, IdrNote } from "./IdrMeetingClient";

interface HistoryItem {
  id: string;
  type: "IDR" | "ESCALATION";
  conclusion: string | null;
  session: { date: string; status: string };
  createdAt: string;
}

interface DealHistoryResponse {
  items: HistoryItem[];
  notes: IdrNote[];
}

interface Props {
  item: IdrItem;
  userEmail: string;
}

export function NoteHistory({ item, userEmail }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const historyQuery = useQuery({
    queryKey: queryKeys.idrMeeting.dealHistory(item.dealId),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/deal-history/${item.dealId}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json() as Promise<DealHistoryResponse>;
    },
    enabled: expanded,
    staleTime: 60 * 1000,
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/idr-meeting/items/${item.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      return res.json();
    },
    onSuccess: () => {
      setNoteContent("");
      setShowNoteInput(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.dealHistory(item.dealId) });
      addToast({ type: "success", title: "Note added" });
    },
    onError: () => {
      addToast({ type: "error", title: "Failed to add note" });
    },
  });

  const handleSubmitNote = useCallback(() => {
    if (noteContent.trim()) addNote.mutate();
  }, [noteContent, addNote]);

  // Merge items and notes into a chronological list
  const entries: { type: "meeting" | "note"; date: string; data: HistoryItem | IdrNote }[] = [];
  if (historyQuery.data) {
    for (const hi of historyQuery.data.items) {
      entries.push({ type: "meeting", date: hi.session.date, data: hi });
    }
    for (const note of historyQuery.data.notes) {
      entries.push({ type: "note", date: note.createdAt, data: note });
    }
  }
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <section>
      <button
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>&#9654;</span>
        History
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Add note button */}
          <div>
            {!showNoteInput ? (
              <button
                className="text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors"
                onClick={() => setShowNoteInput(true)}
              >
                + Add note
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none placeholder:text-muted"
                  placeholder="Add a note..."
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                    onClick={handleSubmitNote}
                    disabled={addNote.isPending || !noteContent.trim()}
                  >
                    {addNote.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    className="rounded-lg border border-t-border bg-surface-2 px-3 py-1 text-xs font-medium text-muted hover:text-foreground transition-colors"
                    onClick={() => {
                      setShowNoteInput(false);
                      setNoteContent("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Loading */}
          {historyQuery.isLoading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 rounded bg-surface-2 animate-pulse" />
              ))}
            </div>
          )}

          {/* Entries */}
          {entries.length === 0 && !historyQuery.isLoading && (
            <p className="text-sm text-muted">No prior history for this deal.</p>
          )}

          {entries.map((entry) => {
            if (entry.type === "meeting") {
              const hi = entry.data as HistoryItem;
              return (
                <div
                  key={`m-${hi.id}`}
                  className="rounded-lg border border-t-border bg-surface-2 p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted">
                      {new Date(hi.session.date).toLocaleDateString()}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        hi.type === "ESCALATION"
                          ? "bg-orange-500/20 text-orange-500"
                          : "bg-surface text-muted"
                      }`}
                    >
                      {hi.type}
                    </span>
                  </div>
                  {hi.conclusion && (
                    <p className="text-sm text-foreground">{hi.conclusion}</p>
                  )}
                  {!hi.conclusion && (
                    <p className="text-sm text-muted italic">No conclusion recorded</p>
                  )}
                </div>
              );
            } else {
              const note = entry.data as IdrNote;
              return (
                <div
                  key={`n-${note.id}`}
                  className="rounded-lg border border-t-border bg-surface-2 p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted">
                      {new Date(note.createdAt).toLocaleDateString()}
                    </span>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
                      Note
                    </span>
                    <span className="text-xs text-muted">{note.author}</span>
                  </div>
                  <p className="text-sm text-foreground">{note.content}</p>
                </div>
              );
            }
          })}
        </div>
      )}
    </section>
  );
}
