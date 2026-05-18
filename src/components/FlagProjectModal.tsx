"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface SearchResult {
  id: string;
  name: string;
  stage: string;
  location: string;
  dealOwner: string;
  alreadyFlagged: boolean;
  url: string;
}

interface FlagProjectModalProps {
  open: boolean;
  onClose: () => void;
  onFlagged: () => void;
}

export default function FlagProjectModal({
  open,
  onClose,
  onFlagged,
}: FlagProjectModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [justFlagged, setJustFlagged] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setJustFlagged(new Set());
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/projects/search?q=${encodeURIComponent(q)}`
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.results ?? []);
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const handleFlag = async (id: string) => {
    setFlagging(id);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: { system_performance_review: "true" },
        }),
      });
      if (res.ok) {
        setJustFlagged((prev) => new Set(prev).add(id));
        onFlagged();
      }
    } catch {
      // silently fail
    } finally {
      setFlagging(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Flag project for production review"
        className="bg-surface border border-t-border rounded-xl shadow-card-lg w-full max-w-lg animate-fadeIn flex flex-col max-h-[80vh]"
      >
        <div className="px-5 py-4 border-b border-t-border">
          <h2 className="text-base font-semibold text-foreground">
            Flag Project for Production Review
          </h2>
          <p className="text-xs text-muted mt-1">
            Search for a project by name to add it to this dashboard.
          </p>
        </div>

        <div className="px-5 py-3 border-b border-t-border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search projects…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-t-border bg-surface-2 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-red-500/40"
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {searching && (
            <div className="px-5 py-8 text-center text-sm text-muted">
              Searching…
            </div>
          )}

          {!searching && query.length >= 2 && results.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-muted">
              No projects found for &ldquo;{query}&rdquo;
            </div>
          )}

          {!searching && query.length < 2 && (
            <div className="px-5 py-8 text-center text-sm text-muted">
              Type at least 2 characters to search.
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="divide-y divide-t-border">
              {results.map((r) => {
                const isFlagged =
                  r.alreadyFlagged || justFlagged.has(r.id);
                return (
                  <div
                    key={r.id}
                    className="px-5 py-3 flex items-center gap-3 hover:bg-surface-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {r.name}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {[r.location, r.stage, r.dealOwner]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {isFlagged ? (
                      <span className="text-xs text-red-400 px-3 py-1 rounded-lg bg-red-500/10 border border-red-500/20 whitespace-nowrap">
                        Flagged
                      </span>
                    ) : (
                      <button
                        onClick={() => handleFlag(r.id)}
                        disabled={flagging === r.id}
                        className="text-xs text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3 py-1 rounded-lg whitespace-nowrap transition-colors"
                      >
                        {flagging === r.id ? "Flagging…" : "Flag"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-t-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-t-border text-foreground hover:bg-surface-2 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
