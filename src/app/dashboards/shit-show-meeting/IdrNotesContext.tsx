"use client";

import { useEffect, useState } from "react";

interface IdrNote {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

export function IdrNotesContext({ dealId }: { dealId: string }) {
  const [notes, setNotes] = useState<IdrNote[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/shit-show-meeting/idr-notes/${dealId}`)
      .then((r) => r.json())
      .then((j: { notes: IdrNote[] }) => {
        if (!cancelled) setNotes(j.notes ?? []);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  if (notes.length === 0) return null;

  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center text-xs uppercase tracking-wider text-muted"
      >
        <span>Recent IDR notes ({notes.length})</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="text-xs border-b border-t-border/40 pb-2 last:border-0">
              <div className="text-muted mb-1">
                {new Date(n.createdAt).toLocaleDateString()} · {n.author}
              </div>
              <div className="text-foreground whitespace-pre-wrap">{n.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
