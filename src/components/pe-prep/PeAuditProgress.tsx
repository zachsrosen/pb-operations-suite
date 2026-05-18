"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AuditEvent, AuditMode } from "@/lib/pe-audit-orchestrator";

interface Props {
  dealId: string;
  milestone: "m1" | "m2";
  onComplete: (auditRunId: string) => void;
  onError: (message: string) => void;
}

interface ProgressItem {
  itemId: string;
  label: string;
  status: string;
  file?: string;
  issues?: string[];
}

/** idle → running → done | interrupted */
type Phase = "idle" | "running" | "done" | "interrupted";

const MODE_LABEL: Record<AuditMode, string> = {
  full: "Full Audit",
  photos: "Photos Only",
  docs: "Docs Only",
};

const MODE_DESC: Record<AuditMode, string> = {
  full: "All docs + photos (parallel — each gets its own time budget)",
  photos: "Re-triage photos only — faster, useful after re-upload",
  docs: "Doc classification + PandaDoc refresh — skips photo work",
};

/**
 * For "full" runs we fire `docs` and `photos` as TWO parallel SSE streams
 * so each gets its own 5-min Vercel function timeout. The browser merges
 * progress events into one unified list.
 */
const MODE_TO_STREAMS: Record<AuditMode, AuditMode[]> = {
  full: ["docs", "photos"],
  docs: ["docs"],
  photos: ["photos"],
};

export function PeAuditProgress({ dealId, milestone, onComplete, onError }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [pandadocEvents, setPandadocEvents] = useState<Array<{ key: string; status: string; action: string }>>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortsRef = useRef<AbortController[]>([]);
  const lastAuditRunIdRef = useRef<string | null>(null);

  const startAudit = useCallback(async (mode: AuditMode) => {
    setPhase("running");
    setItems([]);
    setTotalItems(0);
    setPandadocEvents([]);
    setDiagnostics([]);
    setErrorMsg(null);
    lastAuditRunIdRef.current = null;

    // Abort any prior in-flight streams
    for (const a of abortsRef.current) a.abort();
    abortsRef.current = [];

    const streams = MODE_TO_STREAMS[mode];
    const streamPromises = streams.map(async (streamMode) => {
      const abort = new AbortController();
      abortsRef.current.push(abort);

      const res = await fetch(`/api/pe-prep/${dealId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone, mode: streamMode }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status} (${streamMode})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error(`No response stream (${streamMode})`);

      const decoder = new TextDecoder();
      let buffer = "";
      let sawCompleted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine) as AuditEvent;
            switch (event.type) {
              case "started":
                // Sum totals across parallel streams
                setTotalItems((prev) => prev + event.data.totalItems);
                break;
              case "progress":
                setItems((prev) => {
                  // Dedup by itemId — when streams overlap (full mode), the
                  // first event wins. Photo items come from `photos` stream
                  // only; doc items come from `docs` stream only — so no
                  // collisions in the current mode mapping.
                  if (prev.some((p) => p.itemId === event.data.itemId)) return prev;
                  return [...prev, event.data];
                });
                break;
              case "pandadoc":
                setPandadocEvents((prev) => [...prev, event.data]);
                break;
              case "diagnostic":
                setDiagnostics((prev) => [...prev, `[${streamMode}] ${event.data.message}`]);
                break;
              case "completed":
                sawCompleted = true;
                lastAuditRunIdRef.current = event.data.auditRunId;
                break;
              case "error":
                throw new Error(`${streamMode}: ${event.data.message}`);
            }
          } catch (parseErr) {
            // Throw real errors; ignore JSON parse glitches from partial frames
            if (parseErr instanceof Error && parseErr.message.includes(":")) throw parseErr;
          }
        }
      }

      if (!sawCompleted) {
        throw new Error(`${streamMode} stream ended without "completed" (likely server timeout)`);
      }
    });

    // Wait for ALL parallel streams. If any error, surface partial results.
    try {
      await Promise.all(streamPromises);
      // All streams finished cleanly — call onComplete with the last audit
      // run ID. Each stream creates its own PeAuditRun row; the page reloads
      // the latest one from /status so it doesn't matter which one we pass.
      const finalId = lastAuditRunIdRef.current;
      if (finalId) onComplete(finalId);
      setPhase("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Audit failed";
      onError(msg);
      setErrorMsg(msg);
      setPhase("interrupted");
    }
  }, [dealId, milestone, onComplete, onError]);

  useEffect(() => {
    return () => {
      for (const a of abortsRef.current) a.abort();
    };
  }, []);

  const progressPct = totalItems > 0 ? Math.round((items.length / totalItems) * 100) : 0;

  const itemList = (
    <div className="space-y-1 max-h-48 overflow-y-auto">
      {items.map((item) => (
        <div key={item.itemId} className="flex items-center gap-2 text-xs">
          <span className={
            item.status === "found" ? "text-green-600" :
            item.status === "missing" ? "text-red-600" :
            "text-yellow-600"
          }>
            {item.status === "found" ? "✓" : item.status === "missing" ? "✗" : "?"}
          </span>
          <span className="text-foreground">{item.label}</span>
          {item.file && <span className="text-muted truncate">— {item.file}</span>}
        </div>
      ))}
    </div>
  );

  const modeButtons = (compact = false) => (
    <div className={compact ? "flex gap-2" : "flex flex-wrap gap-2"}>
      {(["full", "photos", "docs"] as const).map((m) => (
        <button
          key={m}
          onClick={() => startAudit(m)}
          title={MODE_DESC[m]}
          className={`px-4 py-2 rounded-lg font-medium text-white ${
            m === "full"
              ? "bg-orange-500 hover:bg-orange-600"
              : "bg-orange-500/70 hover:bg-orange-600"
          }`}
        >
          {compact ? `Re-run ${MODE_LABEL[m]}` : `Run ${MODE_LABEL[m]}`}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Idle — no audit run yet (or previous completed and page refreshed) */}
      {phase === "idle" && modeButtons(false)}

      {/* Running — streaming progress */}
      {phase === "running" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground font-medium">Auditing files…</span>
            <span className="text-muted">{items.length}/{totalItems} items</span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {diagnostics.length > 0 && (
            <div className="text-xs text-yellow-500/80 space-y-0.5">
              {diagnostics.map((msg, i) => (
                <p key={i}>{msg}</p>
              ))}
            </div>
          )}

          {pandadocEvents.length > 0 && (
            <div className="text-xs text-muted space-y-1">
              {pandadocEvents.map((e, i) => (
                <p key={i}>PandaDoc ({e.key}): {e.action}</p>
              ))}
            </div>
          )}

          {itemList}
        </div>
      )}

      {/* Interrupted — stream ended without "completed" (timeout, error, crash) */}
      {phase === "interrupted" && (
        <div className="space-y-3">
          {errorMsg && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
              {errorMsg}
            </div>
          )}

          {items.length > 0 && (
            <>
              <div className="text-xs text-muted">
                Partial results ({items.length}/{totalItems || "?"} items processed before interruption):
              </div>
              {itemList}
            </>
          )}

          {modeButtons(true)}
        </div>
      )}

      {/* Done — audit completed normally, parent page will show full results from DB */}
      {phase === "done" && (
        <div className="space-y-3">
          <div className="text-sm text-green-500 bg-green-500/10 border border-green-500/20 px-3 py-2 rounded-lg">
            Audit complete — {items.length} items processed
          </div>
          {modeButtons(true)}
        </div>
      )}
    </div>
  );
}
