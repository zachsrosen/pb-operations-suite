"use client";

import { useState } from "react";
import type { ShitShowItem, ShitShowDecision } from "./types";
import { DECISION_PILL } from "./types";

interface HistoryEntry {
  id: string;
  sessionId: string;
  decision: ShitShowDecision;
  decisionRationale: string | null;
  meetingDate: string;
}

export function HistoryStrip({ item }: { item: ShitShowItem }) {
  // Reset on dealId change by keying state to dealId
  return <HistoryStripInner key={item.dealId} item={item} />;
}

function HistoryStripInner({ item }: { item: ShitShowItem }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    if (loaded) return;
    const res = await fetch(`/api/shit-show-meeting/search?q=${encodeURIComponent(item.dealName)}`);
    if (res.ok) {
      type SearchItem = {
        id: string;
        sessionId: string;
        dealId: string;
        decision: ShitShowDecision;
        decisionRationale: string | null;
        session: { date: string };
      };
      const json = (await res.json()) as { items: SearchItem[] };
      const filtered = json.items
        .filter((i) => i.dealId === item.dealId && i.id !== item.id)
        .map((i) => ({
          id: i.id,
          sessionId: i.sessionId,
          decision: i.decision,
          decisionRationale: i.decisionRationale,
          meetingDate: i.session.date,
        }));
      setHistory(filtered);
    }
    setLoaded(true);
  }

  if (history.length === 0 && loaded) return null;

  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <button
        onClick={() => {
          if (!open) load();
          setOpen((o) => !o);
        }}
        className="w-full flex justify-between items-center text-xs uppercase tracking-wider text-muted"
      >
        <span>Prior shit-show appearances {history.length > 0 && `(${history.length})`}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {!loaded && <div className="text-xs text-muted">Loading…</div>}
          {history.map((h) => {
            const pill = DECISION_PILL[h.decision];
            return (
              <div
                key={h.id}
                className="flex items-center gap-2 text-xs py-1 border-b border-t-border/40 last:border-0"
              >
                <span className="text-muted shrink-0">
                  {new Date(h.meetingDate).toLocaleDateString()}
                </span>
                <span
                  className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${pill.bg} ${pill.text} shrink-0`}
                >
                  {pill.label}
                </span>
                <span className="text-foreground truncate flex-1">
                  {h.decisionRationale ?? "(no rationale)"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
