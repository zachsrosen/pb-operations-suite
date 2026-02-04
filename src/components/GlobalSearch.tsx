"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";

interface SearchResult {
  id: string;
  name: string;
  stage: string;
  location: string;
  amount: number;
  url?: string;
}

const DASHBOARD_LINKS = [
  // Operations Dashboards
  { name: "Command Center", path: "/dashboards/command-center", description: "Pipeline overview and scheduling" },
  { name: "Pipeline Optimizer", path: "/dashboards/optimizer", description: "AI-powered scheduling optimization" },
  { name: "Master Scheduler", path: "/dashboards/scheduler", description: "Drag-and-drop scheduling calendar" },
  { name: "Site Survey Scheduler", path: "/dashboards/site-survey-scheduler", description: "Schedule site surveys with Zuper" },
  { name: "Construction Scheduler", path: "/dashboards/construction-scheduler", description: "Schedule construction installs with Zuper" },
  { name: "Inspection Scheduler", path: "/dashboards/inspection-scheduler", description: "Schedule inspections with Zuper" },
  { name: "At-Risk Projects", path: "/dashboards/at-risk", description: "Critical project alerts" },
  { name: "Location Comparison", path: "/dashboards/locations", description: "Performance across locations" },
  { name: "Timeline View", path: "/dashboards/timeline", description: "Gantt-style project timeline" },
  // Department Dashboards
  { name: "Design & Engineering", path: "/dashboards/design", description: "Track design progress and approvals" },
  { name: "Permitting & Inspections", path: "/dashboards/permitting", description: "Permit status and inspection tracking" },
  { name: "Interconnection & PTO", path: "/dashboards/interconnection", description: "Utility interconnection and PTO status" },
  { name: "Incentives", path: "/dashboards/incentives", description: "Rebate and incentive tracking" },
  // Other Pipelines
  { name: "Sales Pipeline", path: "/dashboards/sales", description: "Active deals and proposals" },
  { name: "Service Pipeline", path: "/dashboards/service", description: "Service job tracking" },
  { name: "D&R Pipeline", path: "/dashboards/dnr", description: "Detach & Reset projects" },
  { name: "Construction", path: "/dashboards/construction", description: "Construction status and scheduling" },
  { name: "Site Survey", path: "/dashboards/site-survey", description: "Site survey scheduling and status" },
  // Leadership
  { name: "PE Dashboard", path: "/dashboards/pe", description: "Participate Energy tracking" },
  { name: "Executive Summary", path: "/dashboards/executive", description: "KPIs and charts for leadership" },
  { name: "Mobile Dashboard", path: "/dashboards/mobile", description: "Touch-optimized field view" },
  // Help & Info
  { name: "Dashboard Guide", path: "/guide", description: "How to use each dashboard" },
  { name: "Product Updates", path: "/updates", description: "Changelog and release notes" },
  { name: "Product Roadmap", path: "/roadmap", description: "Vote on features and submit ideas" },
];

function useIsMac() {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(
      typeof navigator !== "undefined" &&
        /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent)
    );
  }, []);
  return isMac;
}

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const isMac = useIsMac();
  const modKey = isMac ? "\u2318" : "Ctrl";

  // Filter dashboards by query
  const filteredDashboards = query.length > 0
    ? DASHBOARD_LINKS.filter(
        (d) =>
          d.name.toLowerCase().includes(query.toLowerCase()) ||
          d.description.toLowerCase().includes(query.toLowerCase())
      )
    : DASHBOARD_LINKS;

  // Total selectable items
  const totalItems = filteredDashboards.length + results.length;

  // Keyboard shortcut to open
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Search projects as user types
  const searchProjects = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects?context=executive&search=${encodeURIComponent(q)}`
      );
      if (res.ok) {
        const data = await res.json();
        setResults(
          (data.projects || []).slice(0, 8).map((p: Record<string, unknown>) => ({
            id: p.id as string,
            name: p.name as string,
            stage: p.stage as string,
            location: (p.pbLocation as string) || "Unknown",
            amount: (p.amount as number) || 0,
            url: p.url as string | undefined,
          }))
        );
      }
    } catch {
      // Silently fail search
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchProjects(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchProjects]);

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectItem(selectedIndex);
    }
  }

  function selectItem(index: number) {
    if (index < filteredDashboards.length) {
      router.push(filteredDashboards[index].path);
      setIsOpen(false);
    } else {
      const project = results[index - filteredDashboards.length];
      if (project?.url) {
        window.open(project.url, "_blank");
        setIsOpen(false);
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setIsOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Search panel */}
      <div
        className="relative w-full max-w-xl bg-[#12121a] border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center border-b border-zinc-800 px-4">
          <svg
            className="w-5 h-5 text-zinc-500 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search projects and dashboards..."
            className="flex-1 bg-transparent text-white placeholder-zinc-500 px-3 py-4 outline-none text-sm"
          />
          <kbd className="hidden sm:inline-flex text-xs text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {/* Dashboards section */}
          {filteredDashboards.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Dashboards
              </div>
              {filteredDashboards.map((d, i) => (
                <button
                  key={d.path}
                  onClick={() => selectItem(i)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                    selectedIndex === i
                      ? "bg-orange-500/10 text-orange-400"
                      : "hover:bg-zinc-800/50 text-zinc-300"
                  }`}
                >
                  <span className="text-sm font-medium">{d.name}</span>
                  <span className="text-xs text-zinc-500 truncate">
                    {d.description}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Projects section */}
          {loading && (
            <div className="px-4 py-3 text-sm text-zinc-500">
              Searching projects...
            </div>
          )}

          {results.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Projects
              </div>
              {results.map((r, i) => {
                const globalIndex = i + filteredDashboards.length;
                return (
                  <button
                    key={r.id}
                    onClick={() => selectItem(globalIndex)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors ${
                      selectedIndex === globalIndex
                        ? "bg-orange-500/10 text-orange-400"
                        : "hover:bg-zinc-800/50 text-zinc-300"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.name.split("|")[0].trim()}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {r.location} &middot; {r.stage}
                      </div>
                    </div>
                    <div className="text-xs text-zinc-500 shrink-0 ml-2">
                      {formatMoney(r.amount)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {query.length >= 2 && !loading && results.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">
              No projects found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-4 py-2 flex items-center gap-4 text-xs text-zinc-600">
          <span>
            <kbd className="border border-zinc-700 rounded px-1 py-0.5 mr-1">
              &uarr;&darr;
            </kbd>
            navigate
          </span>
          <span>
            <kbd className="border border-zinc-700 rounded px-1 py-0.5 mr-1">
              &crarr;
            </kbd>
            select
          </span>
          <span>
            <kbd className="border border-zinc-700 rounded px-1 py-0.5 mr-1">
              esc
            </kbd>
            close
          </span>
          <span className="ml-auto">
            <kbd className="border border-zinc-700 rounded px-1 py-0.5 font-mono">
              {modKey}+K
            </kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
