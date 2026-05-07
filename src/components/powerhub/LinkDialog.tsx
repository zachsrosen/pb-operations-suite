"use client";

import { useState } from "react";

interface LinkDialogProps {
  siteId: string;
  siteName: string;
  onClose: () => void;
  onLinked: () => void;
}

export default function LinkDialog({ siteId, siteName, onClose, onLinked }: LinkDialogProps) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  async function handleSearch() {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/deals/search?q=${encodeURIComponent(search)}&limit=10`);
      const data = await res.json();
      setResults(data.deals || []);
    } finally {
      setSearching(false);
    }
  }

  async function handleLink(dealId: string) {
    setLinking(true);
    try {
      const res = await fetch("/api/powerhub/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, dealId }),
      });
      if (res.ok) {
        onLinked();
        onClose();
      }
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-elevated rounded-xl p-6 w-full max-w-lg shadow-xl">
        <h3 className="text-lg font-medium text-foreground mb-1">
          Link Site to Deal
        </h3>
        <p className="text-sm text-muted mb-4">{siteName}</p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search deals by name, address, or ID..."
            className="flex-1 px-3 py-2 bg-surface border border-t-border rounded-lg text-sm text-foreground placeholder-muted"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-4 py-2 bg-cyan-600 text-white text-sm rounded-lg hover:bg-cyan-700 disabled:opacity-50"
          >
            {searching ? "..." : "Search"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
            {results.map((deal: any) => (
              <div
                key={deal.id}
                className="flex items-center justify-between p-3 bg-surface rounded-lg"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {deal.dealname || deal.name}
                  </div>
                  <div className="text-xs text-muted">
                    {deal.property_address || "No address"}
                  </div>
                </div>
                <button
                  onClick={() => handleLink(String(deal.id))}
                  disabled={linking}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
