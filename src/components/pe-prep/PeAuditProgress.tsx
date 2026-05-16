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

export function PeAuditProgress({ dealId, milestone, onComplete, onError }: Props) {
  const [running, setRunning] = useState(false);
  const [items, setItems] = useState<ProgressItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [pandadocEvents, setPandadocEvents] = useState<Array<{ key: string; status: string; action: string }>>([]);
  const abortRef = useRef<AbortController | null>(null);

  const startAudit = useCallback(async () => {
    setRunning(true);
    setItems([]);
    setPandadocEvents([]);

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
        setRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

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
              case "completed":
                onComplete(event.data.auditRunId);
                setRunning(false);
                return;
              case "error":
                onError(event.data.message);
                setRunning(false);
                return;
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err instanceof Error ? err.message : "Audit failed");
      }
    } finally {
      setRunning(false);
    }
  }, [dealId, milestone, onComplete, onError]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const progressPct = totalItems > 0 ? Math.round((items.length / totalItems) * 100) : 0;

  return (
    <div className="space-y-4">
      {!running && items.length === 0 && (
        <button
          onClick={startAudit}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium"
        >
          Run Audit
        </button>
      )}

      {running && (
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

          {pandadocEvents.length > 0 && (
            <div className="text-xs text-muted space-y-1">
              {pandadocEvents.map((e, i) => (
                <p key={i}>PandaDoc ({e.key}): {e.action}</p>
              ))}
            </div>
          )}

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
        </div>
      )}
    </div>
  );
}
