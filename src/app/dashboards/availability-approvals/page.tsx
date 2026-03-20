"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { useActivityTracking } from "@/hooks/useActivityTracking";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface AvailabilityRequest {
  id: string;
  crewMemberId: string;
  crewMember: {
    id: string;
    name: string;
    email: string | null;
    role: string;
    locations: string[];
  };
  requestType: string;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  jobType: string | null;
  reason: string | null;
  originalSlotId: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

type TabStatus = "pending" | "approved" | "rejected";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RequestTypeBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  const styles: Record<string, string> = {
    add: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    modify: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    delete: "bg-red-500/10 text-red-400 border border-red-500/20",
  };
  const cls =
    styles[lower] ?? "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {lower.charAt(0).toUpperCase() + lower.slice(1)}
    </span>
  );
}

export default function AvailabilityApprovalsPage() {
  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabStatus>("pending");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["availability-requests", activeTab],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/availability-requests?status=${activeTab}`
      );
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json() as Promise<{ requests: AvailabilityRequest[] }>;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!isLoading && data && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("availability-approvals");
    }
  }, [isLoading, data, trackDashboardView]);

  const mutation = useMutation({
    mutationFn: async ({
      requestId,
      action,
      note,
    }: {
      requestId: string;
      action: "approve" | "reject";
      note?: string;
    }) => {
      const res = await fetch("/api/admin/availability-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action, note }),
      });
      if (!res.ok) throw new Error("Failed to process request");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability-requests"] });
      setReviewingId(null);
      setReviewNote("");
    },
  });

  const handleAction = useCallback(
    (requestId: string, action: "approve" | "reject") => {
      mutation.mutate({ requestId, action, note: reviewNote || undefined });
    },
    [mutation, reviewNote]
  );

  const requests = data?.requests ?? [];

  const tabs: { key: TabStatus; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <DashboardShell
      title="Availability Approvals"
      accentColor="blue"
      lastUpdated={undefined}
    >
      {/* Tab bar */}
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              activeTab === tab.key
                ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                : "bg-surface-2 text-muted border-t-border hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface border border-t-border rounded-xl overflow-hidden shadow-card">
        {isLoading ? (
          <div className="py-16 text-center text-muted text-sm">
            Loading requests…
          </div>
        ) : error ? (
          <div className="py-16 text-center text-red-400 text-sm">
            Failed to load requests.
          </div>
        ) : requests.length === 0 ? (
          <div className="py-16 text-center text-muted text-sm">
            No {activeTab} requests
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-t-border bg-surface-2">
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Crew Member
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Day
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Time
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Location
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Job Type
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Reason
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    Requested
                  </th>
                  <th className="text-left px-4 py-3 text-muted font-medium whitespace-nowrap">
                    {activeTab === "pending" ? "Actions" : "Review"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border">
                {requests.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-surface-2 transition-colors"
                  >
                    {/* Crew Member */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-foreground">
                        {req.crewMember.name}
                      </div>
                      {req.crewMember.email && (
                        <div className="text-xs text-muted">
                          {req.crewMember.email}
                        </div>
                      )}
                    </td>

                    {/* Request Type */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RequestTypeBadge type={req.requestType} />
                    </td>

                    {/* Day */}
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {req.dayOfWeek != null
                        ? DAY_NAMES[req.dayOfWeek] ?? "—"
                        : "—"}
                    </td>

                    {/* Time */}
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {req.startTime && req.endTime
                        ? `${req.startTime} – ${req.endTime}`
                        : req.startTime || "—"}
                    </td>

                    {/* Location */}
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {req.location ?? "—"}
                    </td>

                    {/* Job Type */}
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {req.jobType ?? "—"}
                    </td>

                    {/* Reason */}
                    <td className="px-4 py-3 text-foreground max-w-[200px]">
                      <span
                        className="block truncate"
                        title={req.reason ?? undefined}
                      >
                        {req.reason ?? "—"}
                      </span>
                    </td>

                    {/* Requested */}
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {relativeTime(req.createdAt)}
                    </td>

                    {/* Actions / Review */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      {activeTab === "pending" ? (
                        <div className="flex flex-col gap-2">
                          {reviewingId === req.id ? (
                            /* Inline reject note */
                            <div className="flex flex-col gap-1.5 min-w-[200px]">
                              <input
                                type="text"
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                                placeholder="Rejection note (optional)"
                                className="px-2 py-1 text-xs rounded border border-t-border bg-surface-2 text-foreground placeholder:text-muted focus:outline-none focus:border-blue-500/50"
                                autoFocus
                              />
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() =>
                                    handleAction(req.id, "reject")
                                  }
                                  disabled={mutation.isPending}
                                  className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors disabled:opacity-50"
                                >
                                  Confirm Reject
                                </button>
                                <button
                                  onClick={() => {
                                    setReviewingId(null);
                                    setReviewNote("");
                                  }}
                                  className="px-2 py-1 rounded text-xs font-medium bg-surface-2 hover:bg-surface-elevated text-muted transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                onClick={() =>
                                  handleAction(req.id, "approve")
                                }
                                disabled={mutation.isPending}
                                className="px-3 py-1 rounded text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 transition-colors disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => {
                                  setReviewingId(req.id);
                                  setReviewNote("");
                                }}
                                disabled={mutation.isPending}
                                className="px-3 py-1 rounded text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Reviewed info for approved/rejected tabs */
                        <div className="text-xs text-muted space-y-0.5">
                          {req.reviewedBy && (
                            <div className="text-foreground">{req.reviewedBy}</div>
                          )}
                          {req.reviewedAt && (
                            <div>{relativeTime(req.reviewedAt)}</div>
                          )}
                          {req.reviewNote && (
                            <div
                              className="italic max-w-[180px] truncate"
                              title={req.reviewNote}
                            >
                              &ldquo;{req.reviewNote}&rdquo;
                            </div>
                          )}
                          {!req.reviewedBy && !req.reviewNote && "—"}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
