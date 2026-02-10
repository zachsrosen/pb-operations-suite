"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  category: "performance" | "features" | "integrations" | "ux" | "analytics";
  status: "planned" | "in-progress" | "completed" | "under-review";
  votes: number;
  isOfficial: boolean; // true = from PB team, false = user submitted
  submittedBy?: string;
  createdAt: string;
}

interface NewIdea {
  title: string;
  description: string;
  category: RoadmapItem["category"];
}

const CATEGORY_STYLES = {
  performance: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", label: "Performance" },
  features: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", label: "Features" },
  integrations: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30", label: "Integrations" },
  ux: { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/30", label: "UX/UI" },
  analytics: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30", label: "Analytics" },
};

const STATUS_STYLES = {
  "planned": { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "Planned" },
  "in-progress": { bg: "bg-orange-500/20", text: "text-orange-400", label: "In Progress" },
  "completed": { bg: "bg-green-500/20", text: "text-green-400", label: "Completed" },
  "under-review": { bg: "bg-indigo-500/20", text: "text-indigo-400", label: "Under Review" },
};

export default function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [votedItems, setVotedItems] = useState<Set<string>>(new Set());
  const [showNewIdeaModal, setShowNewIdeaModal] = useState(false);
  const [newIdea, setNewIdea] = useState<NewIdea>({ title: "", description: "", category: "features" });
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<"all" | RoadmapItem["status"]>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | RoadmapItem["category"]>("all");
  const [sortBy, setSortBy] = useState<"votes" | "newest">("votes");
  const [isAdmin, setIsAdmin] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Load roadmap items
  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/roadmap");
      if (res.ok) {
        const data = await res.json();
        let loadedItems = data.items || [];

        // Merge in any localStorage vote counts (for persistence on Vercel)
        const localVoteCounts = JSON.parse(localStorage.getItem("roadmap-vote-counts") || "{}");
        if (Object.keys(localVoteCounts).length > 0) {
          loadedItems = loadedItems.map((item: RoadmapItem) => ({
            ...item,
            votes: item.votes + (localVoteCounts[item.id] || 0)
          }));
        }

        setItems(loadedItems);
      }
    } catch (error) {
      console.error("Failed to load roadmap:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Check if current user is an admin
  const checkAdminStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session");
      if (res.ok) {
        const session = await res.json();
        if (session?.user?.email) {
          // Check user role from our API
          const userRes = await fetch("/api/user/me");
          if (userRes.ok) {
            const userData = await userRes.json();
            if (userData.user?.role === "ADMIN") {
              setIsAdmin(true);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to check admin status:", error);
    }
  }, []);

  // Load voted items from localStorage and check admin status
  useEffect(() => {
    const stored = localStorage.getItem("roadmap-votes");
    if (stored) {
      setVotedItems(new Set(JSON.parse(stored)));
    }
    // Check admin status from server
    checkAdminStatus();
    loadItems();
  }, [loadItems, checkAdminStatus]);

  // Show toast notification
  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Handle status update (admin only)
  const handleStatusUpdate = async (itemId: string, newStatus: RoadmapItem["status"]) => {
    if (!isAdmin) return;

    const item = items.find(i => i.id === itemId);
    const _oldStatus = item?.status;

    setUpdatingStatus(itemId);
    try {
      const res = await fetch("/api/roadmap", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, status: newStatus }),
      });

      if (res.ok) {
        setItems(prev => prev.map(i =>
          i.id === itemId ? { ...i, status: newStatus } : i
        ));
        showToast(`"${item?.title}" updated to ${STATUS_STYLES[newStatus].label}`);
      } else {
        showToast("Failed to update status", "error");
      }
    } catch (error) {
      console.error("Failed to update status:", error);
      showToast("Failed to update status", "error");
    } finally {
      setUpdatingStatus(null);
    }
  };

  // Handle vote - uses localStorage for persistence since Vercel has read-only filesystem
  const handleVote = async (itemId: string) => {
    if (votedItems.has(itemId)) return; // Already voted

    // Update local state immediately for better UX
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, votes: item.votes + 1 } : item
    ));

    // Save to localStorage
    const newVoted = new Set(votedItems).add(itemId);
    setVotedItems(newVoted);
    localStorage.setItem("roadmap-votes", JSON.stringify([...newVoted]));

    // Also save vote counts to localStorage for persistence
    const currentVoteCounts = JSON.parse(localStorage.getItem("roadmap-vote-counts") || "{}");
    currentVoteCounts[itemId] = (currentVoteCounts[itemId] || 0) + 1;
    localStorage.setItem("roadmap-vote-counts", JSON.stringify(currentVoteCounts));

    // Try server-side vote (may fail on Vercel due to read-only filesystem)
    try {
      await fetch("/api/roadmap/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
    } catch (error) {
      console.warn("Server-side vote failed (expected on Vercel):", error);
    }
  };

  // Handle submit new idea
  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdea.title.trim() || !newIdea.description.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/roadmap/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newIdea),
      });

      if (res.ok) {
        const data = await res.json();
        setItems(prev => [data.item, ...prev]);
        setNewIdea({ title: "", description: "", category: "features" });
        setShowNewIdeaModal(false);
      }
    } catch (error) {
      console.error("Failed to submit idea:", error);
    } finally {
      setSubmitting(false);
    }
  };

  // Filter and sort items
  const filteredItems = items
    .filter(item => filter === "all" || item.status === filter)
    .filter(item => categoryFilter === "all" || item.category === categoryFilter)
    .sort((a, b) => {
      if (sortBy === "votes") return b.votes - a.votes;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const statusCounts = {
    all: items.length,
    planned: items.filter(i => i.status === "planned").length,
    "in-progress": items.filter(i => i.status === "in-progress").length,
    "under-review": items.filter(i => i.status === "under-review").length,
    completed: items.filter(i => i.status === "completed").length,
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-lg shadow-lg transition-all ${
          toast.type === "error" ? "bg-red-600" : "bg-green-600"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                Product Roadmap
                {isAdmin && (
                  <span className="text-[0.6rem] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                    ADMIN
                  </span>
                )}
              </h1>
              <p className="text-xs text-zinc-500">Vote on features & submit ideas</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/updates"
              className="flex items-center gap-2 text-xs text-zinc-400 hover:text-emerald-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Updates
            </Link>
            <button
              onClick={() => setShowNewIdeaModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Submit Idea
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Intro */}
        <div className="mb-8 p-4 bg-gradient-to-br from-orange-500/10 to-orange-500/5 border border-orange-500/30 rounded-xl">
          <p className="text-zinc-300">
            Help shape the future of PB Operations Suite! Vote on features you want to see,
            or submit your own ideas. The most popular requests help us prioritize what to build next.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          {/* Status filter */}
          <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg">
            {(["all", "planned", "in-progress", "under-review", "completed"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  filter === status
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {status === "all" ? "All" : STATUS_STYLES[status].label}
                <span className="ml-1 text-xs text-zinc-500">({statusCounts[status]})</span>
              </button>
            ))}
          </div>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_STYLES).map(([key, style]) => (
              <option key={key} value={key}>{style.label}</option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-orange-500"
          >
            <option value="votes">Most Votes</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {/* Items List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500"></div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-500">No items match your filters</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredItems.map((item) => {
              const categoryStyle = CATEGORY_STYLES[item.category];
              const statusStyle = STATUS_STYLES[item.status];
              const hasVoted = votedItems.has(item.id);

              return (
                <div
                  key={item.id}
                  className="bg-[#12121a] border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex gap-4">
                    {/* Vote button */}
                    <button
                      onClick={() => handleVote(item.id)}
                      disabled={hasVoted}
                      className={`flex flex-col items-center justify-center w-16 h-16 rounded-lg transition-colors ${
                        hasVoted
                          ? "bg-orange-500/20 text-orange-400 cursor-default"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                      }`}
                    >
                      <svg
                        className={`w-5 h-5 ${hasVoted ? "text-orange-400" : ""}`}
                        fill={hasVoted ? "currentColor" : "none"}
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 15l7-7 7 7"
                        />
                      </svg>
                      <span className="text-sm font-bold">{item.votes}</span>
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {item.isOfficial && (
                            <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">
                              Official
                            </span>
                          )}
                          {isAdmin ? (
                            <div className="relative">
                              <select
                                value={item.status}
                                onChange={(e) => handleStatusUpdate(item.id, e.target.value as RoadmapItem["status"])}
                                disabled={updatingStatus === item.id}
                                className={`text-xs px-2 py-1 rounded-md font-medium cursor-pointer border appearance-none pr-6 ${
                                  updatingStatus === item.id
                                    ? "opacity-50"
                                    : ""
                                } ${statusStyle.bg} ${statusStyle.text} border-${statusStyle.text.replace("text-", "")}/30 focus:ring-2 focus:ring-orange-500 focus:outline-none`}
                                style={{ minWidth: "110px" }}
                              >
                                <option value="planned" className="bg-zinc-900 text-zinc-300">📋 Planned</option>
                                <option value="in-progress" className="bg-zinc-900 text-orange-300">🔨 In Progress</option>
                                <option value="under-review" className="bg-zinc-900 text-indigo-300">🔍 Under Review</option>
                                <option value="completed" className="bg-zinc-900 text-green-300">✅ Completed</option>
                              </select>
                              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
                                {updatingStatus === item.id ? (
                                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className={`text-[0.65rem] px-1.5 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text} font-medium`}>
                              {statusStyle.label}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-400 mb-3">{item.description}</p>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={`px-2 py-0.5 rounded ${categoryStyle.bg} ${categoryStyle.text}`}>
                          {categoryStyle.label}
                        </span>
                        {item.submittedBy && (
                          <span className="text-zinc-600">
                            Submitted by {item.submittedBy}
                          </span>
                        )}
                        <span className="text-zinc-600">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-sm text-zinc-600">
          <p>Have a specific bug report or urgent request?</p>
          <p className="mt-1">
            Contact:{" "}
            <a href="mailto:zach@photonbrothers.com" className="text-orange-400 hover:underline">
              zach@photonbrothers.com
            </a>
          </p>
        </div>
      </main>

      {/* New Idea Modal */}
      {showNewIdeaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-[#12121a] border border-zinc-800 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Submit an Idea</h2>
              <button
                onClick={() => setShowNewIdeaModal(false)}
                className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmitIdea}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">
                    Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={newIdea.title}
                    onChange={(e) => setNewIdea(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Brief summary of your idea"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                    required
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">
                    Description <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={newIdea.description}
                    onChange={(e) => setNewIdea(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe your idea in more detail. What problem does it solve? How would it help your workflow?"
                    rows={4}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500 resize-none"
                    required
                    maxLength={500}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">
                    Category
                  </label>
                  <select
                    value={newIdea.category}
                    onChange={(e) => setNewIdea(prev => ({ ...prev, category: e.target.value as NewIdea["category"] }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                  >
                    {Object.entries(CATEGORY_STYLES).map(([key, style]) => (
                      <option key={key} value={key}>{style.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowNewIdeaModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !newIdea.title.trim() || !newIdea.description.trim()}
                  className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  {submitting ? "Submitting..." : "Submit Idea"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
