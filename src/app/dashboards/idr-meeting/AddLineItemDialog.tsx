"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";

interface CatalogProduct {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  sku: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  hubspotProductId: string | null;
}

interface Props {
  dealId: string;
  open: boolean;
  onClose: () => void;
}

export function AddLineItemDialog({ dealId, open, onClose }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedId(null);
      setQuantity(1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    setSelectedId(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json() as CatalogProduct[];
          setResults(data);
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No product selected");
      const res = await fetch(`/api/idr-meeting/line-items/${dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalProductId: selectedId, quantity }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      const selected = results.find((r) => r.id === selectedId);
      addToast({ type: "success", title: `Added ${selected?.brand} ${selected?.model}` });
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.idrMeeting.root, "lineItems", dealId],
      });
      onClose();
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: err.message });
    },
  });

  if (!open) return null;

  const selected = results.find((r) => r.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-t-border bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground mb-3">Add Line Item from Catalog</h3>

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search products by brand, model, or SKU..."
          className="w-full rounded border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground
            placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500/50"
        />

        {/* Results */}
        <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
          {searching && <p className="text-xs text-muted p-2">Searching...</p>}
          {!searching && query.length >= 2 && results.length === 0 && (
            <p className="text-xs text-muted p-2">No products found</p>
          )}
          {results.map((product) => (
            <button
              key={product.id}
              onClick={() => setSelectedId(product.id)}
              className={`w-full text-left rounded px-2 py-1.5 text-xs transition-colors
                ${selectedId === product.id
                  ? "bg-orange-500/10 border border-orange-500/30"
                  : "hover:bg-surface-2 border border-transparent"
                }`}
            >
              <div className="font-medium text-foreground">
                {product.brand} {product.model}
              </div>
              <div className="text-muted">
                {product.category} {product.sku ? ` · ${product.sku}` : ""}
                {!product.hubspotProductId && " · ⚠ No HubSpot ID"}
              </div>
            </button>
          ))}
        </div>

        {/* Quantity + Add */}
        {selected && (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-muted">Qty:</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground text-center"
            />
            <button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !selected.hubspotProductId}
              className="ml-auto rounded bg-orange-500 px-3 py-1.5 text-xs font-medium text-white
                hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {addMutation.isPending ? "Adding..." : "Add to Deal"}
            </button>
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-t-border py-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
