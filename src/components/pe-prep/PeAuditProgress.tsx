"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AuditEvent } from "@/lib/pe-audit-orchestrator";

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

export function PeAuditProgress({ dealId, milestone, onComplete, onError }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [pandadocEvents, setPandadocEvents] = useState<Array<{ key: string; status: string; action: string }>>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const completedRef = useRef(false);

  const startAudit = useCallback(async () => {
    setPhase("running");
    setItems([]);
    setTotalItems(0);
    setPandadocEvents([]);
    setDiagnostics([]);
    setErrorMsg(null);
    completedRef.current = false;

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/pe-prep/${dealId}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        onError(text || `HTTP ${res.status}`);
        setErrorMsg(text || `HTTP ${res.status}`);
        setPhase("interrupted");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setPhase("interrupted");
        setErrorMsg("No response stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

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
                setTotalItems(event.data.totalItems);
                break;
              case "progress":
                setItems((prev) => [...prev, event.data]);
                break;
              case "pandadoc":
                setPandadocEvents((prev) => [...prev, event.data]);
                break;
              case "diagnostic":
                setDiagnostics((prev) => [...prev, event.data.message]);
                break;
              case "completed":
                completedRef.current = true;
                onComplete(event.data.auditRunId);
                setPhase("done");
                return;
              case "error":
                onError(event.data.message);
                setErrorMsg(event.data.message);
                setPhase("interrupted");
                return;
            }
          } catch {}
        }
      }

      // Stream ended without a "completed" event — server timeout or crash
      if (!completedRef.current) {
        const msg = "Audit stream ended unexpectedly (likely server timeout). Partial results shown below.";
        setErrorMsg(msg);
        setPhase("interrupted");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "Audit failed";
        onError(msg);
        setErrorMsg(msg);
        setPhase("interrupted");
      }
    }
  }, [dealId, milestone, onComplete, onError]);

  useEffect(() => {
    return () => abortRef.current?.abort();
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

  return (
    <div className="space-y-4">
      {/* Idle — no audit run yet (or previous completed and page refreshed) */}
      {phase === "idle" && (
        <button
          onClick={startAudit}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium"
        >
          Run Audit
        </button>
      )}

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

          <button
            onClick={startAudit}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium"
          >
            Re-run Audit
          </button>
        </div>
      )}

      {/* Done — audit completed normally, parent page will show full results from DB */}
      {phase === "done" && (
        <button
          onClick={() => { setPhase("idle"); setItems([]); }}
          className="px-4 py-2 bg-orange-500/80 text-white rounded-lg hover:bg-orange-600 font-medium"
        >
          Re-run Audit
        </button>
      )}
    </div>
  );
}
