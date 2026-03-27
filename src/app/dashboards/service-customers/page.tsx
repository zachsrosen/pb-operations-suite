"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import DashboardShell from "@/components/DashboardShell";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import type {
  ContactSearchResult,
  ContactDetail,
  ContactDeal as BaseContactDeal,
  ContactTicket as BaseContactTicket,
  ContactJob as BaseContactJob,
} from "@/lib/customer-resolver";
import { getZuperJobUrl } from "@/lib/external-links";

// ---------------------------------------------------------------------------
// Types (client-side mirrors — extends server types with enrichment fields)
// ---------------------------------------------------------------------------

interface EnrichedDeal extends BaseContactDeal {
  serviceType?: string | null;
  lastContactDate?: string | null;
  daysInStage?: number | null;
  lineItems?: Array<{ name: string; quantity: number; category: string | null; unitPrice: number | null }> | null;
  hubspotUrl?: string | null;
}

interface EnrichedTicket extends BaseContactTicket {
  serviceType?: string | null;
  daysInStage?: number | null;
}

interface EnrichedJob extends BaseContactJob {
  assignedUsers?: string[];
  completedDate?: string | null;
  zuperUrl?: string | null;
}

interface EnrichedContactDetail extends Omit<ContactDetail, "deals" | "tickets" | "jobs"> {
  deals: EnrichedDeal[];
  tickets: EnrichedTicket[];
  jobs: EnrichedJob[];
}

interface SearchResponse {
  results: ContactSearchResult[];
  query: string;
  truncated: boolean;
  lastUpdated: string;
}

interface DetailResponse {
  customer: EnrichedContactDetail;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "\u2014";
  }
}

// Matches DEFAULT_HUBSPOT_PORTAL_ID in src/lib/external-links.ts.
// Hardcoded because this is a client component and can't read server-side env vars.
const HUBSPOT_PORTAL_ID = "21710069";

function hubspotDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}`;
}

function hubspotTicketUrl(ticketId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/ticket/${ticketId}`;
}

function hubspotContactUrl(contactId: string): string {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CustomerHistoryPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactSearchResult[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail panel state
  const [selectedContact, setSelectedContact] =
    useState<ContactSearchResult | null>(null);
  const [detail, setDetail] = useState<EnrichedContactDetail | null>(null);
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
        const res = await fetch(
          `/api/service/customers?q=${encodeURIComponent(value.trim())}`
        );
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

  // Fetch detail when a contact card is clicked
  const handleSelectContact = useCallback(
    async (contact: ContactSearchResult) => {
      setSelectedContact(contact);
      setDetail(null);
      setDetailLoading(true);

      try {
        const res = await fetch(
          `/api/service/customers/${contact.contactId}`
        );
        if (!res.ok) throw new Error("Failed to load customer detail");
        const data: DetailResponse = await res.json();
        setDetail(data.customer);
      } catch {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    []
  );

  // Close slide-over on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedContact(null);
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
            {truncated &&
              " (more results available \u2014 try a more specific search)"}
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

      {/* Contact Cards Grid */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-grid">
          {results.map((contact) => (
            <button
              key={contact.contactId}
              onClick={() => handleSelectContact(contact)}
              className={`text-left p-4 bg-surface rounded-lg border transition-all hover:shadow-lg ${
                selectedContact?.contactId === contact.contactId
                  ? "border-cyan-500 shadow-cyan-500/20"
                  : "border-t-border hover:border-cyan-500/50"
              }`}
            >
              <h3 className="font-semibold text-foreground truncate">
                {[contact.firstName, contact.lastName]
                  .filter(Boolean)
                  .join(" ") || "Unknown"}
              </h3>
              <p className="text-sm text-muted mt-1 truncate">
                {contact.email || "No email"}
              </p>
              {contact.address && (
                <p className="text-sm text-muted truncate">
                  {contact.address}
                </p>
              )}
              {contact.companyName && (
                <p className="text-xs text-muted mt-1">
                  {contact.companyName}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Slide-Over Detail Panel */}
      {selectedContact && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedContact(null)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-surface border-l border-t-border shadow-2xl z-50 overflow-y-auto">
            {/* Panel Header */}
            <div className="sticky top-0 bg-surface border-b border-t-border p-4 flex items-center justify-between z-10">
              <div className="min-w-0 flex-1 mr-3">
                {detailLoading || !detail ? (
                  <h2 className="text-lg font-semibold text-foreground truncate">
                    {[
                      selectedContact.firstName,
                      selectedContact.lastName,
                    ]
                      .filter(Boolean)
                      .join(" ") || "Unknown"}
                  </h2>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold text-foreground truncate">
                      {[detail.firstName, detail.lastName]
                        .filter(Boolean)
                        .join(" ") || "Unknown"}
                    </h2>
                    {detail.email && (
                      <a
                        href={hubspotContactUrl(detail.contactId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-cyan-500 hover:underline truncate block"
                      >
                        {detail.email}
                      </a>
                    )}
                    {detail.address && (
                      <p className="text-sm text-muted truncate">
                        {detail.address}
                      </p>
                    )}
                    {detail.companyName && (
                      <p className="text-xs text-muted">
                        {detail.companyName}
                      </p>
                    )}
                    {detail.phone && (
                      <p className="text-xs text-muted">{detail.phone}</p>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={() => setSelectedContact(null)}
                className="text-muted hover:text-foreground p-1"
              >
                &#10005;
              </button>
            </div>

            <div className="p-4 space-y-6">
              {detailLoading ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner />
                </div>
              ) : detail ? (
                <>
                  {/* Three-Column Grid: Deals | Tickets | Jobs */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Deals */}
                    <section>
                      <h3 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
                        Deals ({detail.deals.length})
                      </h3>
                      {detail.deals.length === 0 ? (
                        <p className="text-sm text-muted italic">
                          None found
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {detail.deals.map((d) => (
                            <a
                              key={d.id}
                              href={d.hubspotUrl || hubspotDealUrl(d.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-2 rounded bg-surface-2 hover:bg-surface-2/80 transition-colors"
                            >
                              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {d.name}
                                </p>
                                {d.serviceType && (
                                  <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-300">
                                    {d.serviceType}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted">
                                {d.stage}
                                {d.daysInStage != null && d.daysInStage > 0 && (
                                  <span> · {d.daysInStage}d in stage</span>
                                )}
                                {" · "}
                                {d.location || "No location"}
                              </p>
                              <p className="text-xs text-muted">
                                {formatDate(d.closeDate)}
                                {d.amount &&
                                  ` · $${Number(d.amount).toLocaleString()}`}
                              </p>
                              {d.lineItems && d.lineItems.length > 0 && (
                                <div className="mt-1 text-xs text-muted">
                                  <span className="font-medium">{d.lineItems.length} line item{d.lineItems.length !== 1 ? "s" : ""}</span>
                                  {" — "}
                                  {d.lineItems.slice(0, 2).map(li => li.name).join(", ")}
                                  {d.lineItems.length > 2 && `, +${d.lineItems.length - 2} more`}
                                </div>
                              )}
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
                        <p className="text-sm text-muted italic">
                          None found
                        </p>
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
                              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {t.subject}
                                </p>
                                {t.serviceType && (
                                  <span className="rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-300">
                                    {t.serviceType}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted">
                                {t.status}
                                {t.priority && ` · ${t.priority}`}
                                {t.daysInStage != null && t.daysInStage > 0 && (
                                  <span> · {t.daysInStage}d in stage</span>
                                )}
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
                        <p className="text-sm text-muted italic">
                          None found
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {detail.jobs.map((j) => {
                            const url = j.zuperUrl || getZuperJobUrl(j.uid);
                            const Wrapper = url ? "a" : "div";
                            const linkProps = url
                              ? {
                                  href: url,
                                  target: "_blank",
                                  rel: "noopener noreferrer",
                                }
                              : {};
                            return (
                              <Wrapper
                                key={j.uid}
                                {...linkProps}
                                className={`block p-2 rounded bg-surface-2${url ? " hover:bg-surface transition-colors" : ""}`}
                              >
                                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                  <p className="text-sm font-medium text-foreground truncate">
                                    {j.title}
                                  </p>
                                  {j.completedDate && (
                                    <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                                      Completed
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted">
                                  {j.category || "No category"}
                                  {j.status && ` · ${j.status}`}
                                </p>
                                {j.assignedUsers && j.assignedUsers.length > 0 && (
                                  <p className="text-xs text-muted">
                                    {j.assignedUsers.join(", ")}
                                  </p>
                                )}
                                <p className="text-xs text-muted">
                                  {formatDate(j.scheduledDate)}
                                </p>
                              </Wrapper>
                            );
                          })}
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
