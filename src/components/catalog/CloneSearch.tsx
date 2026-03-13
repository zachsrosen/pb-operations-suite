"use client";
import { useState } from "react";

interface CloneResult {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  unitSpec: string | null;
  unitLabel: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  hardToProcure: boolean;
  sku: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  photoUrl: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  zohoItemId: string | null;
  // Spec relations — one will be populated based on category
  moduleSpec: Record<string, unknown> | null;
  inverterSpec: Record<string, unknown> | null;
  batterySpec: Record<string, unknown> | null;
  evChargerSpec: Record<string, unknown> | null;
  mountingHardwareSpec: Record<string, unknown> | null;
  electricalHardwareSpec: Record<string, unknown> | null;
  relayDeviceSpec: Record<string, unknown> | null;
}

interface CloneSearchProps {
  onSelect: (product: CloneResult) => void;
  onCancel: () => void;
}

export default function CloneSearch({ onSelect, onCancel }: CloneSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CloneResult[]>([]);
  const [loading, setLoading] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search by brand, model, or description..."
          className="flex-1 rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          autoFocus
        />
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      {loading && <p className="text-sm text-muted">Searching...</p>}
      {results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r)}
              className="w-full text-left rounded-lg border border-t-border bg-surface-2 p-3 hover:bg-surface transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
                  {r.category}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {r.brand} — {r.model}
                </span>
              </div>
              {r.description && (
                <p className="text-xs text-muted mt-1 line-clamp-1">{r.description}</p>
              )}
            </button>
          ))}
        </div>
      )}
      {query.length >= 2 && !loading && results.length === 0 && (
        <p className="text-sm text-muted">No matching products found.</p>
      )}
    </div>
  );
}
