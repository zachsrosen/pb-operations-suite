"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import type {
  CustomerSummary,
  CustomerDetail,
  CustomerContact,
} from "@/lib/customer-resolver";

// ---------------------------------------------------------------------------
// Types (client-side mirrors)
// ---------------------------------------------------------------------------

interface SearchResponse {
  results: CustomerSummary[];
  query: string;
  truncated: boolean;
  lastUpdated: string;
}

interface DetailResponse {
  customer: CustomerDetail;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

// NOTE: This page is a client component ("use client"), so env vars must use
// NEXT_PUBLIC_ prefix. Ensure NEXT_PUBLIC_HUBSPOT_PORTAL_ID is set in Vercel
// env config (mirrors the existing HUBSPOT_PORTAL_ID server-side var).
function hubspotDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/deal/${dealId}`;
}

function hubspotTicketUrl(ticketId: string): string {
  return `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/ticket/${ticketId}`;
}

function hubspotContactUrl(contactId: string): string {
  return `https://app.hubspot.com/contacts/${process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || ""}/contact/${contactId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomerHistoryPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail panel state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setTruncated(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/service/customers?q=${encodeURIComponent(value.trim())}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Search failed (${res.status})`);
        }
        const data: SearchResponse = await res.json();
        setResults(data.results);
        setTruncated(data.truncated);
        setLastUpdated(data.lastUpdated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  // Fetch detail when a customer card is clicked
  const handleSelectCustomer = useCallback(async (customer: CustomerSummary) => {
    setSelectedCustomer(customer);
    setDetail(null);
    setDetailLoading(true);

    try {
      const groupKeyEncoded = encodeURIComponent(customer.groupKey);
      const res = await fetch(
        `/api/service/customers/${groupKeyEncoded}`
      );
      if (!res.ok) throw new Error("Failed to load customer detail");
      const data: DetailResponse = await res.json();
      setDetail(data.customer);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Close slide-over on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedCustomer(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <DashboardShell
      title="Customer History"
      accentColor="cyan"
      lastUpdated={lastUpdated}
      fullWidth
    >
      {/* Search Bar */}
      <div className="max-w-2xl mx-auto mb-8">
        <div className="relative">
          <input
            type="text"
            placeholder="Search by customer name, email, phone, or address..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full px-4 py-3 bg-surface border border-t-border rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-cyan-500" />
            </div>
          )}
        </div>
        {query.trim().length >= 2 && !loading && (
          <p className="text-sm text-muted mt-2">
            {results.length} result{results.length !== 1 ? "s" : ""}
            {truncated && " (more results available — try a more specific search)"}
          </p>
        )}
      </div>

      {/* Error State */}
      {error && <ErrorState message={error} />}

      {/* Empty State */}
      {!loading && !error && results.length === 0 && (
        <div className="text-center text-muted py-16">
          {query.trim().length < 2
            ? "Search by customer name, email, phone, or address"
            : `No customers found for "${query}"`}
        </div>
      )}

      {/* Customer Cards Grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-grid">
          {results.map((customer) => (
            <button
              key={customer.groupKey}
              onClick={() => handleSelectCustomer(customer)}
              className={`text-left p-4 bg-surface rounded-lg border transition-all hover:shadow-lg ${
                selectedCustomer?.groupKey === customer.groupKey
                  ? "border-cyan-500 shadow-cyan-500/20"
                  : "border-t-border hover:border-cyan-500/50"
              }`}
            >
              <h3 className="font-semibold text-foreground truncate">
                {customer.displayName}
              </h3>
              <p className="text-sm text-muted mt-1 truncate">{customer.address}</p>
              <p className="text-xs text-muted mt-2">
                {customer.contactIds.length} contact{customer.contactIds.length !== 1 ? "s" : ""}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Slide-Over Detail Panel */}
      {selectedCustomer && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedCustomer(null)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-surface border-l border-t-border shadow-2xl z-50 overflow-y-auto">
            {/* Panel Header */}
            <div className="sticky top-0 bg-surface border-b border-t-border p-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-semibold text-foreground truncate">
                {selectedCustomer.displayName}
              </h2>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="text-muted hover:text-foreground p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-6">
              {detailLoading ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : detail ? (
                <>
                  {/* Contacts */}
                  <section>
                    <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                      Contacts ({detail.contacts.length})
                    </h3>
                    <div className="space-y-2">
                      {detail.contacts.map((c: CustomerContact) => (
                        <a
                          key={c.id}
                          href={hubspotContactUrl(c.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                        >
                          <span className="text-foreground font-medium">
                            {[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"}
                          </span>
                          {c.email && (
                            <span className="text-sm text-muted ml-2">{c.email}</span>
                          )}
                          {c.phone && (
                            <span className="text-sm text-muted ml-2">{c.phone}</span>
                          )}
                        </a>
                      ))}
                    </div>
                  </section>

                  {/* Three-Column Grid: Deals | Tickets | Jobs */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Deals */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Deals ({detail.deals.length})
                      </h3>
                      {detail.deals.length === 0 ? (
                        <p className="text-sm text-muted italic">None found</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.deals.map((d) => (
                            <a
                              key={d.id}
                              href={hubspotDealUrl(d.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {d.name}
                              </p>
                              <p className="text-xs text-muted">
                                {d.stage} · {d.location || "No location"}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(d.closeDate)}
                                {d.amount && ` · $${Number(d.amount).toLocaleString()}`}
                              </p>
                            </a>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Tickets */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Tickets ({detail.tickets.length})
                      </h3>
                      {detail.tickets.length === 0 ? (
                        <p className="text-sm text-muted italic">None found</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.tickets.map((t) => (
                            <a
                              key={t.id}
                              href={hubspotTicketUrl(t.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {t.subject}
                              </p>
                              <p className="text-xs text-muted">
                                {t.status}
                                {t.priority && ` · ${t.priority}`}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(t.createDate)}
                              </p>
                            </a>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Zuper Jobs */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Jobs ({detail.jobs.length})
                      </h3>
                      {detail.jobs.length === 0 ? (
                        <p className="text-sm text-muted italic">None found</p>
                      ) : (
                        <div className="space-y-2">
                          {detail.jobs.map((j) => (
                            <div
                              key={j.uid}
                              className="p-2 rounded bg-surface-2"
                            >
                              <p className="text-sm font-medium text-foreground truncate">
                                {j.title}
                              </p>
                              <p className="text-xs text-muted">
                                {j.category || "No category"}
                                {j.status && ` · ${j.status}`}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(j.scheduledDate)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <ErrorState message="Failed to load customer detail" />
              )}
            </div>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
