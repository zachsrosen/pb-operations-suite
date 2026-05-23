"use client";

import { useState, useCallback, useRef } from "react";

interface EagleViewOrderSummary {
  id: string;
  reportId: string;
  status: string;
  triggeredBy: string;
  orderedAt: string;
  deliveredAt: string | null;
  driveFolderId: string | null;
  errorMessage: string | null;
  ticketId: string | null;
}

interface SearchResult {
  id: string;
  type: "deal" | "ticket";
  title: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  stage: string | null;
  amount: string | null;
  priority: string | null;
  eagleviewOrder: EagleViewOrderSummary | null;
}

export default function EagleViewOrdersClient({ userEmail }: { userEmail: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<Record<string, boolean>>({});
  const [orderResults, setOrderResults] = useState<Record<string, { status: string; reportId?: string; reason?: string }>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/eagleview/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const handleOrder = async (result: SearchResult, force = false) => {
    const key = `${result.type}:${result.id}`;
    setOrdering((prev) => ({ ...prev, [key]: true }));
    setOrderResults((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const body: Record<string, unknown> = { force };
      if (result.type === "deal") body.dealId = result.id;
      else body.ticketId = result.id;
      const res = await fetch("/api/eagleview/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Order failed (${res.status})`);
      setOrderResults((prev) => ({ ...prev, [key]: { status: data.status, reportId: data.reportId, reason: data.reason } }));
      // Refresh search to update order status
      doSearch(query);
    } catch (err) {
      setOrderResults((prev) => ({
        ...prev,
        [key]: { status: "ERROR", reason: err instanceof Error ? err.message : "Unknown error" },
      }));
    } finally {
      setOrdering((prev) => ({ ...prev, [key]: false }));
    }
  };

  const formatAddress = (r: SearchResult) => {
    const parts = [r.address, r.city, r.state, r.zip].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  };

  const hasAddress = (r: SearchResult) => Boolean(r.address && r.city && r.zip);

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search deals or tickets by PROJ number, customer name, or address…"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-4 py-3 pl-10 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-orange-500/50"
        />
        <svg className="absolute left-3 top-3.5 h-5 w-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {searching && (
          <div className="absolute right-3 top-3.5">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          <button onClick={() => doSearch(query)} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!searching && results.length === 0 && query.length < 2 && (
        <div className="py-16 text-center text-muted">
          Search for a deal or ticket to order EagleView imagery
        </div>
      )}

      {/* No results */}
      {!searching && results.length === 0 && query.length >= 2 && (
        <div className="py-16 text-center text-muted">
          No deals or tickets found for &ldquo;{query}&rdquo;
        </div>
      )}

      {/* Results */}
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
        {results.map((r) => {
          const key = `${r.type}:${r.id}`;
          const isOrdering = ordering[key];
          const orderResult = orderResults[key];
          const order = r.eagleviewOrder;
          const addr = formatAddress(r);
          const canOrder = hasAddress(r) && (!order || order.status === "FAILED");

          return (
            <div key={key} className="rounded-lg border border-border bg-surface p-4 space-y-3">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                      r.type === "deal"
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-purple-500/20 text-purple-400"
                    }`}>
                      {r.type === "deal" ? "Deal" : "Ticket"}
                    </span>
                    <h3 className="truncate text-sm font-medium text-foreground">{r.title}</h3>
                  </div>
                  {addr && <p className="mt-1 text-xs text-muted">{addr}</p>}
                  {!addr && <p className="mt-1 text-xs text-red-400">No address on record</p>}
                </div>
                <div className="text-right text-xs text-muted whitespace-nowrap">
                  {r.type === "deal" && r.amount && (
                    <div className="font-medium text-foreground">
                      ${Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                  )}
                  {r.type === "ticket" && r.priority && (
                    <div>Priority: {r.priority}</div>
                  )}
                  {r.stage && <div>{r.stage}</div>}
                </div>
              </div>

              {/* EagleView status */}
              {order && (
                <div className={`flex items-center gap-2 rounded px-3 py-2 text-xs ${
                  order.status === "DELIVERED"
                    ? "bg-green-500/10 text-green-400"
                    : order.status === "ORDERED"
                      ? "bg-blue-500/10 text-blue-400"
                      : order.status === "FAILED"
                        ? "bg-red-500/10 text-red-400"
                        : "bg-zinc-500/10 text-muted"
                }`}>
                  <span className="font-medium">{order.status}</span>
                  {order.reportId && !order.reportId.startsWith("pending:") && (
                    <span>— Report #{order.reportId}</span>
                  )}
                  {order.errorMessage && <span>— {order.errorMessage}</span>}
                  {order.triggeredBy && (
                    <span className="ml-auto text-muted">by {order.triggeredBy}</span>
                  )}
                </div>
              )}

              {/* Order result feedback */}
              {orderResult && (
                <div className={`rounded px-3 py-2 text-xs ${
                  orderResult.status === "ORDERED"
                    ? "bg-green-500/10 text-green-400"
                    : orderResult.status === "ERROR" || orderResult.status === "FAILED"
                      ? "bg-red-500/10 text-red-400"
                      : "bg-blue-500/10 text-blue-400"
                }`}>
                  {orderResult.status === "ORDERED" && `Ordered — Report #${orderResult.reportId}`}
                  {orderResult.status === "FAILED" && `Failed: ${orderResult.reason}`}
                  {orderResult.status === "ERROR" && `Error: ${orderResult.reason}`}
                </div>
              )}

              {/* Action button */}
              <div className="flex justify-end">
                {!order && canOrder && (
                  <button
                    onClick={() => handleOrder(r)}
                    disabled={isOrdering}
                    className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    {isOrdering ? "Ordering…" : "Order TrueDesign"}
                  </button>
                )}
                {order?.status === "FAILED" && (
                  <button
                    onClick={() => handleOrder(r, true)}
                    disabled={isOrdering}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {isOrdering ? "Retrying…" : "Retry Order"}
                  </button>
                )}
                {!hasAddress(r) && (
                  <span className="text-xs text-muted italic">Address required to order</span>
                )}
                {order && (order.status === "ORDERED" || order.status === "DELIVERED") && (
                  <span className="text-xs text-muted italic">Order exists</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
