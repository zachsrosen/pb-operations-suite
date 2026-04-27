"use client";

import { useEffect, useRef, useState } from "react";
import type { ShitShowItem } from "./types";

export function MeetingNotesForm({
  item,
  onSaved,
}: {
  item: ShitShowItem;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(item.meetingNotes ?? "");
  const [saving, setSaving] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);
  const lastSaved = useRef(item.meetingNotes ?? "");

  useEffect(() => {
    setValue(item.meetingNotes ?? "");
    lastSaved.current = item.meetingNotes ?? "";
  }, [item.id, item.meetingNotes]);

  function onChange(v: string) {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (v === lastSaved.current) return;
      setSaving(true);
      try {
        await fetch(`/api/shit-show-meeting/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingNotes: v }),
        });
        lastSaved.current = v;
        await onSaved();
      } finally {
        setSaving(false);
      }
    }, 500);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs uppercase tracking-wider text-muted">Meeting notes</div>
        {saving && <div className="text-xs text-muted">Saving…</div>}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder="What was discussed?"
        className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
      />
    </div>
  );
}
