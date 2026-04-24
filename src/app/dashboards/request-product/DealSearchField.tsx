"use client";

import { useEffect, useRef, useState } from "react";

type DealHit = {
  id: string;
  name?: string;
  customer?: string;
  address?: string;
  stage?: string;
  location?: string;
};

function formatLabel(d: DealHit): string {
  const parts: string[] = [];
  if (d.customer) parts.push(d.customer);
  else if (d.name) parts.push(d.name);
  if (d.address) parts.push(d.address);
  return parts.filter(Boolean).join(" — ") || `Deal ${d.id}`;
}

export default function DealSearchField({
  value,
  onChange,
  initialLabel,
}: {
  value: string;
  onChange: (dealId: string, label: string) => void;
  initialLabel?: string;
}) {
  const [query, setQuery] = useState(initialLabel || "");
  const [hits, setHits] = useState<DealHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel || "");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Hide results if user clears the field
    if (!query.trim()) {
      setHits([]);
      setOpen(false);
      if (value) onChange("", "");
      return;
    }
    // Stop hitting API if we already selected this label
    if (query === selectedLabel) {
      setOpen(false);
      return;
    }
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }

    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(`/api/deals/search?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setHits([]);
          return;
        }
        const body = await res.json();
        const arr = Array.isArray(body?.deals) ? body.deals : Array.isArray(body) ? body : [];
        setHits(arr.slice(0, 10));
        setOpen(true);
      } catch {
        // aborted or network — ignore
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, selectedLabel, value, onChange]);

  function pick(d: DealHit) {
    const label = formatLabel(d);
    setQuery(label);
    setSelectedLabel(label);
    setOpen(false);
    onChange(d.id, label);
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedLabel("");
        }}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by customer name or address"
        className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
      />
      {value && selectedLabel && (
        <div className="mt-1 text-xs text-cyan-400">✓ Deal {value} selected</div>
      )}
      {loading && !open && <div className="mt-1 text-xs text-muted">Searching…</div>}
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-t-border bg-surface-elevated shadow-card">
          {hits.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(d)}
                className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-t-border last:border-b-0"
              >
                <div className="text-sm text-foreground">{formatLabel(d)}</div>
                <div className="text-xs text-muted">
                  Deal {d.id}
                  {d.stage ? ` · ${d.stage}` : ""}
                  {d.location ? ` · ${d.location}` : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.trim().length >= 2 && hits.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-t-border bg-surface-elevated shadow-card px-3 py-2 text-xs text-muted">
          No deals match &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
