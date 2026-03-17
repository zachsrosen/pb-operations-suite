"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Vendor {
  zohoVendorId: string;
  name: string;
}

interface VendorPickerProps {
  vendorName: string;
  zohoVendorId: string;
  onChange: (vendorName: string, zohoVendorId: string) => void;
  /** Placeholder hint from AI extraction or legacy clone */
  hint?: string;
}

export default function VendorPicker({
  vendorName,
  zohoVendorId,
  onChange,
  hint,
}: VendorPickerProps) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [staleVendorHint, setStaleVendorHint] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValidatedVendorRef = useRef(false);

  const fetchVendors = useCallback(async (includeId?: string) => {
    setLoading(true);
    setFetchError(false);
    try {
      const params = includeId ? `?includeId=${encodeURIComponent(includeId)}` : "";
      const res = await fetch(`/api/catalog/vendors${params}`);
      if (!res.ok) throw new Error("Failed to fetch vendors");
      const data = await res.json();
      setVendors(data.vendors ?? []);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch (include current vendor if it might be inactive)
  useEffect(() => {
    fetchVendors(zohoVendorId || undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate zohoVendorId against fetched list — detect stale IDs from clones/imports.
  // Uses a ref guard to ensure this check runs exactly once (when vendors first load),
  // while keeping all deps in the array to satisfy exhaustive-deps.
  useEffect(() => {
    if (loading || fetchError || vendors.length === 0) return;
    if (hasValidatedVendorRef.current) return;
    hasValidatedVendorRef.current = true;

    if (!zohoVendorId) return;

    const found = vendors.some((v) => v.zohoVendorId === zohoVendorId);
    if (!found) {
      // Stale ID: vendor was deleted from Zoho since this product was created/cloned
      setStaleVendorHint(vendorName || "Unknown vendor");
      onChange("", "");
    }
  }, [vendors, loading, fetchError, zohoVendorId, vendorName, onChange]);

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = vendors.filter((v) =>
    v.name.toLowerCase().includes(query.toLowerCase())
  );

  function select(v: Vendor) {
    onChange(v.name, v.zohoVendorId);
    setQuery("");
    setOpen(false);
    setStaleVendorHint(null);
  }

  function clear() {
    onChange("", "");
    setQuery("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
        e.preventDefault();
        break;
      case "ArrowUp":
        setHighlighted((h) => Math.max(h - 1, 0));
        e.preventDefault();
        break;
      case "Enter":
        if (filtered[highlighted]) select(filtered[highlighted]);
        e.preventDefault();
        break;
      case "Escape":
        setOpen(false);
        e.preventDefault();
        break;
    }
  }

  const displayValue = vendorName || "";
  const placeholder = hint
    ? `AI suggested: ${hint} — select to confirm`
    : "Search vendors...";

  return (
    <div ref={containerRef} className="relative">
      {vendorName ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground">
            {displayValue}
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlighted(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        />
      )}

      {open && !vendorName && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-t-border bg-surface-elevated shadow-card">
          {loading && (
            <div className="px-3 py-2 text-xs text-muted">Loading vendors...</div>
          )}
          {fetchError && (
            <div className="px-3 py-2 text-xs text-red-400">
              Failed to load vendors.{" "}
              <button
                type="button"
                onClick={() => fetchVendors()}
                className="underline hover:text-foreground"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !fetchError && filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted">
              {query
                ? "No matching vendor found."
                : "No vendors available."}
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => fetchVendors()}
                  className="text-cyan-400 underline hover:text-cyan-300 mr-2"
                >
                  Refresh list
                </button>
                <span className="text-muted">
                  or contact admin to add it in Zoho
                </span>
              </div>
            </div>
          )}
          {!loading &&
            filtered.map((v, i) => (
              <button
                key={v.zohoVendorId}
                type="button"
                onClick={() => select(v)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  i === highlighted
                    ? "bg-cyan-500/10 text-foreground"
                    : "text-foreground hover:bg-surface-2"
                }`}
              >
                {v.name}
              </button>
            ))}
        </div>
      )}
      {/* Stale vendor hint — shown when cloned/imported vendor no longer exists */}
      {staleVendorHint && !vendorName && (
        <p className="mt-1 text-xs text-amber-400">
          Previously selected vendor &ldquo;{staleVendorHint}&rdquo; is no longer available. Please re-select.
        </p>
      )}
    </div>
  );
}
