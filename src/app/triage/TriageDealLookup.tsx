"use client";

import { useState } from "react";

type DealSearchResult = {
  id: string;
  name: string;
  amount: number;
  location: string;
  address: string;
  stage?: string;
};

type Props = {
  onSelect: (deal: { id: string; name: string; shop: string }) => void;
};

/**
 * Step 1 of the triage flow: let the rep either paste a dealId directly or
 * search by customer name / address. Hands the selected deal back to the
 * parent page, which starts a `TriageRun` keyed to that deal.
 */
export default function TriageDealLookup({ onSelect }: Props) {
  const [mode, setMode] = useState<"search" | "direct">("search");
  const [query, setQuery] = useState("");
  const [dealIdInput, setDealIdInput] = useState("");
  const [results, setResults] = useState<DealSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) {
      setError("Enter at least 2 characters");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const deals: DealSearchResult[] = Array.isArray(data?.deals)
        ? data.deals
        : [];
      setResults(deals);
      if (deals.length === 0) setError("No matches. Try a different search.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function pickById() {
    const id = dealIdInput.trim();
    if (!id) {
      setError("Enter a deal ID");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Deal ${id} not found`);
      const data = await res.json();
      const p = data?.project;
      if (!p) throw new Error("Deal not found");
      onSelect({
        id: String(p.id),
        name: p.name ?? "Deal",
        shop: p.pbLocation ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Triage</h1>
        <p className="text-sm text-muted">
          Find the deal you&apos;re triaging to start.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-t-border bg-surface p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
            mode === "search"
              ? "bg-orange-500 text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => setMode("direct")}
          className={`flex-1 rounded-md px-3 py-2 font-medium transition-colors ${
            mode === "direct"
              ? "bg-orange-500 text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          Deal ID
        </button>
      </div>

      {mode === "search" ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              Customer name or address
            </span>
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="e.g. Jones or 123 Main"
              className="rounded-lg border border-t-border bg-surface px-3 py-3 text-base text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <button
            type="button"
            onClick={runSearch}
            disabled={loading}
            className="rounded-lg bg-orange-500 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-muted">
              HubSpot deal ID
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={dealIdInput}
              onChange={(e) => setDealIdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") pickById();
              }}
              placeholder="e.g. 123456789"
              className="rounded-lg border border-t-border bg-surface px-3 py-3 text-base text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </label>
          <button
            type="button"
            onClick={pickById}
            disabled={loading}
            className="rounded-lg bg-orange-500 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
          >
            {loading ? "Looking up…" : "Open deal"}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {mode === "search" && results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() =>
                  onSelect({ id: d.id, name: d.name, shop: d.location })
                }
                className="w-full rounded-lg border border-t-border bg-surface p-3 text-left transition-colors hover:bg-surface-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {d.name}
                    </div>
                    {d.address && (
                      <div className="truncate text-xs text-muted">
                        {d.address}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right text-xs text-muted">
                    <div>{d.location}</div>
                    {d.stage && <div className="mt-0.5">{d.stage}</div>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
