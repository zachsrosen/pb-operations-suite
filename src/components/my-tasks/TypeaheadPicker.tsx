"use client";

import { useEffect, useRef, useState } from "react";

export interface TypeaheadValue {
  id: string;
  label: string;
  subtitle?: string | null;
}

interface TypeaheadPickerProps {
  label: string;
  placeholder: string;
  /** "deal" | "contact" | "ticket" — passed to /api/hubspot/search */
  type: "deal" | "contact" | "ticket";
  value: TypeaheadValue | null;
  onChange: (v: TypeaheadValue | null) => void;
}

export default function TypeaheadPicker({
  label,
  placeholder,
  type,
  value,
  onChange,
}: TypeaheadPickerProps) {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<TypeaheadValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced search
  useEffect(() => {
    if (value) return; // Don't search when a value is already picked
    const q = input.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const r = await fetch(`/api/hubspot/search?type=${type}&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = (await r.json()) as { hits: TypeaheadValue[] };
        setResults(data.hits);
        setHighlight(0);
      } catch {
        // swallow — user will see empty results
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [input, type, value]);

  // Click-outside to close
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const clear = () => {
    onChange(null);
    setInput("");
    setResults([]);
    setOpen(false);
  };

  const pick = (hit: TypeaheadValue) => {
    onChange(hit);
    setInput("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-[10px] uppercase tracking-wide text-muted">{label}</label>

      {value ? (
        <div className="mt-1 flex items-center gap-2 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1.5 text-xs">
          <span className="truncate text-foreground">{value.label}</span>
          {value.subtitle && (
            <span className="truncate text-muted">· {value.subtitle}</span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted">#{value.id}</span>
          <button
            type="button"
            onClick={clear}
            className="text-muted hover:text-foreground"
            aria-label="Clear"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(results.length - 1, h + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === "Enter" && results[highlight]) {
                e.preventDefault();
                pick(results[highlight]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="mt-1 w-full rounded border border-t-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
          />
          {open && input.trim().length >= 2 && (
            <div className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-t-border bg-surface-elevated shadow-card-lg">
              {loading ? (
                <div className="px-3 py-2 text-xs text-muted">Searching…</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted">No matches.</div>
              ) : (
                <ul>
                  {results.map((hit, idx) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => pick(hit)}
                        className={`block w-full px-3 py-2 text-left text-xs ${
                          idx === highlight ? "bg-surface-2 text-foreground" : "text-foreground/80"
                        }`}
                      >
                        <div className="font-medium">{hit.label}</div>
                        {hit.subtitle && (
                          <div className="truncate text-[10px] text-muted">{hit.subtitle}</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
