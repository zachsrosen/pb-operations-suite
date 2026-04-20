"use client";

import { useState } from "react";

type Pool = {
  id: string;
  name: string;
  lastPublishedAt: Date | string | null;
  lastPublishedThrough: string | null;
  icalToken: string | null;
  horizonMonths: number;
};

export function PublishCard({ pool }: { pool: Pool }) {
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [lastPublishedAt, setLastPublishedAt] = useState(pool.lastPublishedAt);
  const [lastPublishedThrough, setLastPublishedThrough] = useState(pool.lastPublishedThrough);
  const [icalToken, setIcalToken] = useState(pool.icalToken);
  const [rotating, setRotating] = useState(false);

  async function publishNow() {
    setPublishing(true);
    setResult(null);
    try {
      const res = await fetch(`/api/on-call/pools/${pool.id}/publish`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setResult(json.error ?? "Publish failed");
      } else {
        setResult(`Published: +${json.rowsCreated} new, ${json.rowsUpdated} updated, through ${json.to}`);
        setLastPublishedAt(new Date().toISOString());
        setLastPublishedThrough(json.to);
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function rotateToken() {
    if (!confirm("Rotate the iCal token? Anyone subscribed with the old URL will need to resubscribe.")) return;
    setRotating(true);
    try {
      const res = await fetch(`/api/on-call/pools/${pool.id}/rotate-token`, { method: "POST" });
      const json = await res.json();
      if (res.ok) setIcalToken(json.icalToken);
    } finally {
      setRotating(false);
    }
  }

  const icalUrl = icalToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/on-call/calendar/${pool.id}?token=${icalToken}`
    : null;

  return (
    <div className="bg-surface border border-t-border rounded-lg p-5">
      <h3 className="text-base font-semibold mb-4">Publish &amp; Export — {pool.name}</h3>

      <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4 mb-4">
        <div className="text-xs uppercase tracking-wider text-orange-300 mb-2">Publish Schedule</div>
        <p className="text-sm text-muted mb-3">
          Generates the next {pool.horizonMonths} months of assignments using strict round-robin.
          Existing swap and PTO rows are preserved.
        </p>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted">
            {lastPublishedAt
              ? <>Last published <strong className="text-foreground">{new Date(lastPublishedAt).toLocaleString()}</strong>{lastPublishedThrough && <> · covers through {lastPublishedThrough}</>}</>
              : <>Never published</>}
          </div>
          <button type="button" onClick={publishNow} disabled={publishing}
                  className="px-4 py-2 rounded bg-orange-500 text-white text-sm font-medium disabled:opacity-50">
            {publishing ? "Publishing…" : "Publish Now"}
          </button>
        </div>
        {result && <p className="text-xs mt-2 text-muted">{result}</p>}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">Google Calendar Subscribe URL</div>
        {icalUrl ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={icalUrl}
              className="flex-1 bg-surface-2 border border-t-border rounded px-2 py-1.5 text-xs font-mono truncate"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button type="button" onClick={rotateToken} disabled={rotating}
                    className="text-xs px-2 py-1.5 rounded border border-t-border text-muted hover:text-foreground">
              {rotating ? "Rotating…" : "Rotate"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted italic">No token set.</p>
        )}
        <p className="text-xs text-muted mt-1">Copy this URL into Google Calendar → Other calendars → Subscribe from URL.</p>
      </div>
    </div>
  );
}
