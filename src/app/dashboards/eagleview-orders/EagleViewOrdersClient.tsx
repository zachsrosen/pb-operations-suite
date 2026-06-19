"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";

interface EagleViewOrderSummary {
  id: string;
  dealId: string;
  reportId: string;
  productCode: string;
  status: string;
  triggeredBy: string;
  surveyDate: string | null;
  orderedAt: string;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  errorMessage: string | null;
  failedAttempts: number;
  cost: number | null;
  driveFolderId: string | null;
  imageDriveFileId: string | null;
  layoutJsonDriveFileId: string | null;
  shadeJsonDriveFileId: string | null;
  reportPdfDriveFileId: string | null;
  reportXmlDriveFileId: string | null;
  ticketId: string | null;
  createdAt: string;
  updatedAt: string;
}

const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const trueDesignUrl = (reportId: string) => `https://apps.eagleview.com/truedesign/${reportId}`;
const orderUrl = (reportId: string) => `https://apps.eagleview.com/myev/orders/report/${reportId}`;

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

const STATUS_CLASSES: Record<string, string> = {
  DELIVERED: "bg-green-500/10 text-green-400",
  ORDERED: "bg-blue-500/10 text-blue-400",
  FAILED: "bg-red-500/10 text-red-400",
};

function OrderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted shrink-0">{label}</span>
      <span className="text-right text-foreground break-words">{children}</span>
    </div>
  );
}

function OrderDetailDrawer({
  order,
  result,
  onClose,
}: {
  order: EagleViewOrderSummary;
  result: SearchResult;
  onClose: () => void;
}) {
  const files: { label: string; id: string | null }[] = [
    { label: "Report PDF", id: order.reportPdfDriveFileId },
    { label: "Report XML", id: order.reportXmlDriveFileId },
    { label: "Aerial image", id: order.imageDriveFileId },
    { label: "Layout JSON", id: order.layoutJsonDriveFileId },
    { label: "Shade JSON", id: order.shadeJsonDriveFileId },
  ];
  const hasReport = order.reportId && !order.reportId.startsWith("pending:");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface-elevated p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">EVTD Order Details</h2>
            <p className="truncate text-xs text-muted">{result.title}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Status + TrueDesign */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[order.status] ?? "bg-zinc-500/10 text-muted"}`}>
            {order.status}
          </span>
          {hasReport && (
            <a
              href={trueDesignUrl(order.reportId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-orange-400 underline underline-offset-2 hover:opacity-80"
            >
              Open in TrueDesign ↗
            </a>
          )}
          {hasReport && (
            <a
              href={orderUrl(order.reportId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 underline underline-offset-2 hover:opacity-80"
            >
              View full order ↗
            </a>
          )}
        </div>

        {order.errorMessage && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
            {order.errorMessage}
          </div>
        )}

        {/* Fields */}
        <div className="divide-y divide-border border-y border-border">
          <OrderRow label="Report #">{hasReport ? order.reportId : "—"}</OrderRow>
          <OrderRow label="Product">{order.productCode}</OrderRow>
          <OrderRow label="Linked record">
            {result.type === "deal" ? "Deal" : "Ticket"} {result.type === "deal" ? order.dealId : order.ticketId ?? "—"}
          </OrderRow>
          <OrderRow label="Triggered by">{order.triggeredBy}</OrderRow>
          <OrderRow label="Ordered">{fmtDateTime(order.orderedAt)}</OrderRow>
          <OrderRow label="Est. delivery">{fmtDateTime(order.estimatedDeliveryAt)}</OrderRow>
          <OrderRow label="Delivered">{fmtDateTime(order.deliveredAt)}</OrderRow>
          <OrderRow label="Survey date">{fmtDateTime(order.surveyDate)}</OrderRow>
          <OrderRow label="Cost">{order.cost != null ? `$${order.cost.toLocaleString()}` : "—"}</OrderRow>
          <OrderRow label="Failed attempts">{order.failedAttempts}</OrderRow>
          <OrderRow label="Updated">{fmtDateTime(order.updatedAt)}</OrderRow>
        </div>

        {/* Files */}
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Files</h3>
          {order.driveFolderId ? (
            <a
              href={driveFolderUrl(order.driveFolderId)}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 inline-flex items-center gap-1 text-sm text-blue-400 underline underline-offset-2 hover:opacity-80"
            >
              📁 Drive folder ↗
            </a>
          ) : (
            <p className="text-sm text-muted">No Drive folder yet.</p>
          )}
          <ul className="mt-1 space-y-1">
            {files.map((f) => (
              <li key={f.label} className="text-sm">
                {f.id ? (
                  <a
                    href={driveFileUrl(f.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline underline-offset-2 hover:opacity-80"
                  >
                    {f.label} ↗
                  </a>
                ) : (
                  <span className="text-muted">{f.label} — not available</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
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

/** Lightweight row for the default "all orders" list (server-fetched + cache-joined). */
export interface OrderListRow {
  id: string;
  dealId: string;
  ticketId: string | null;
  reportId: string;
  status: string;
  triggeredBy: string;
  orderedAt: string;
  deliveredAt: string | null;
  driveFolderId: string | null;
  errorMessage: string | null;
  failedAttempts: number;
  dealName: string | null;
  address: string | null;
  pbLocation: string | null;
  hubspotUrl: string | null;
}

const STATUS_FILTERS = ["ALL", "ORDERED", "DELIVERED", "FAILED", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function EagleViewOrdersClient({
  userEmail,
  initialOrders,
}: {
  userEmail: string;
  initialOrders: OrderListRow[];
}) {
  void userEmail;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [locationFilter, setLocationFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<Record<string, boolean>>({});
  const [orderResults, setOrderResults] = useState<Record<string, { status: string; reportId?: string; reason?: string }>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [detailOrder, setDetailOrder] = useState<{ order: EagleViewOrderSummary; result: SearchResult } | null>(null);

  // Default view = all orders; the search results replace it once you type (>=2 chars).
  const showList = query.length < 2;
  const locations = Array.from(
    new Set(initialOrders.map((o) => o.pbLocation).filter((l): l is string => Boolean(l))),
  ).sort();
  // Counts reflect the current location filter so the chip numbers match the list.
  const locScoped =
    locationFilter === "ALL"
      ? initialOrders
      : initialOrders.filter((o) => o.pbLocation === locationFilter);
  const statusCounts = STATUS_FILTERS.reduce((acc, s) => {
    acc[s] = s === "ALL" ? locScoped.length : locScoped.filter((o) => o.status === s).length;
    return acc;
  }, {} as Record<StatusFilter, number>);
  const filteredOrders =
    statusFilter === "ALL" ? locScoped : locScoped.filter((o) => o.status === statusFilter);

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

      {/* Default view: all EagleView orders with status filter */}
      {showList && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-orange-600 text-white"
                      : "bg-surface-2 text-muted hover:text-foreground"
                  }`}
                >
                  {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()} ({statusCounts[s]})
                </button>
              ))}
            </div>
            {locations.length > 1 && (
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                aria-label="Filter by location"
              >
                <option value="ALL">All locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            )}
          </div>

          {initialOrders.length === 0 ? (
            <div className="py-16 text-center text-muted">
              No EagleView orders yet. Search above to order one.
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-12 text-center text-muted">No orders with this status.</div>
          ) : (
            <ul className="space-y-2">
              {filteredOrders.map((o) => {
                const hasReport = o.reportId && !o.reportId.startsWith("pending:");
                const title =
                  o.dealName ||
                  (o.ticketId ? `Ticket ${o.ticketId}` : `Deal ${o.dealId}`);
                return (
                  <li key={o.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span
                        className={`inline-flex shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                          STATUS_CLASSES[o.status] ?? "bg-zinc-500/10 text-muted"
                        }`}
                      >
                        {o.status}
                      </span>
                      {o.hubspotUrl ? (
                        <a
                          href={o.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:text-orange-400 hover:underline"
                          title="Open deal in HubSpot"
                        >
                          {title}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {title}
                        </span>
                      )}
                      {hasReport && (
                        <a
                          href={trueDesignUrl(o.reportId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs text-orange-400 underline underline-offset-2 hover:opacity-80"
                        >
                          Report #{o.reportId} ↗
                        </a>
                      )}
                      {hasReport && (
                        <a
                          href={orderUrl(o.reportId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs text-blue-400 underline underline-offset-2 hover:opacity-80"
                        >
                          Order ↗
                        </a>
                      )}
                      {o.driveFolderId && (
                        <a
                          href={driveFolderUrl(o.driveFolderId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs text-blue-400 underline underline-offset-2 hover:opacity-80"
                        >
                          📁 Drive ↗
                        </a>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                      {o.pbLocation && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-foreground">
                          {o.pbLocation}
                        </span>
                      )}
                      {o.address && <span className="truncate">{o.address}</span>}
                      <span>Ordered {fmtDateTime(o.orderedAt)}</span>
                      {o.deliveredAt && <span>· Delivered {fmtDateTime(o.deliveredAt)}</span>}
                      <span>· by {o.triggeredBy}</span>
                    </div>
                    {o.status === "FAILED" && o.errorMessage && (
                      <div className="mt-1 text-xs text-red-400">
                        {o.errorMessage}
                        {o.failedAttempts > 0
                          ? ` (${o.failedAttempts} attempt${o.failedAttempts === 1 ? "" : "s"})`
                          : ""}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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
                    <span>
                      —{" "}
                      <a
                        href={`https://apps.eagleview.com/truedesign/${order.reportId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:opacity-80"
                        title="Open this design in EagleView TrueDesign"
                      >
                        Report #{order.reportId} ↗
                      </a>
                      {" · "}
                      <a
                        href={orderUrl(order.reportId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:opacity-80"
                        title="View the full EagleView order"
                      >
                        Order ↗
                      </a>
                    </span>
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

              {/* Action row */}
              <div className="flex items-center justify-between gap-2">
                {order ? (
                  <button
                    onClick={() => setDetailOrder({ order, result: r })}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
                  >
                    Details
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
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
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {detailOrder && (
        <OrderDetailDrawer
          order={detailOrder.order}
          result={detailOrder.result}
          onClose={() => setDetailOrder(null)}
        />
      )}
    </div>
  );
}
