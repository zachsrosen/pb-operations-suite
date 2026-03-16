"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { sanitizeSopContent } from "@/lib/sop-sanitize";
import "./sop-content.css";

// Dynamic import — CodeMirror is browser-only
const SopEditor = dynamic(() => import("@/components/sop/SopEditor"), {
  ssr: false,
  loading: () => <div className="sop-loading">Loading editor...</div>,
});

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface SopSectionMeta {
  id: string;
  tabId: string;
  sidebarGroup: string;
  title: string;
  dotColor: string;
  sortOrder: number;
  updatedAt: string;
  updatedBy: string | null;
}

interface SopTab {
  id: string;
  label: string;
  sortOrder: number;
  sections: SopSectionMeta[];
}

interface SopSectionFull extends SopSectionMeta {
  content: string;
  version: number;
}

/* ------------------------------------------------------------------ */
/* Dot color helper                                                    */
/* ------------------------------------------------------------------ */

const DOT_COLORS: Record<string, string> = {
  blue: "#1a56db",
  green: "#059669",
  amber: "#d97706",
  red: "#dc2626",
  purple: "#7c3aed",
  pink: "#db2777",
  teal: "#0d9488",
  indigo: "#4f46e5",
};

function DotIcon({ color }: { color: string }) {
  return (
    <span
      className="sop-dot"
      style={{ background: DOT_COLORS[color] || "#9ca3af" }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* SVG Icons                                                           */
/* ------------------------------------------------------------------ */

function LogoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {open ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" opacity="0.3" />
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Main SOP Page                                                       */
/* ------------------------------------------------------------------ */

function SOPLoading() {
  return (
    <div className="sop-page sop-shell">
      <div className="sop-loading">Loading SOP Guide...</div>
    </div>
  );
}

export default function SOPPage() {
  return (
    <Suspense fallback={<SOPLoading />}>
      <SOPPageInner />
    </Suspense>
  );
}

function SOPPageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tabs, setTabs] = useState<SopTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [activeSectionId, setActiveSectionId] = useState<string>("");
  const [sectionContent, setSectionContent] = useState<SopSectionFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SopSectionMeta[] | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Role-based editing state
  const [userRole, setUserRole] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pendingSuggestionCount, setPendingSuggestionCount] = useState(0);

  const canEdit = userRole === "ADMIN" || userRole === "OWNER";
  const canSuggest = !!userRole && userRole !== "VIEWER" && !canEdit;

  // Tab visibility: admins/owners see all, everyone else sees public + role-specific
  const PUBLIC_TABS = ["hubspot", "ops", "ref"];
  const PM_GUIDE_USERS = ["alexis", "kaitlyn", "kat", "natasha"];
  const showAllTabs = canEdit;
  const userFirstName = (session?.user?.name || "").split(" ")[0].toLowerCase();
  const canSeePmGuide = showAllTabs || PM_GUIDE_USERS.includes(userFirstName);
  const visibleTabs = tabs.filter(
    (t) => showAllTabs || PUBLIC_TABS.includes(t.id) || (t.id === "pm" && canSeePmGuide)
  );

  // Section visibility: hide admin-only sections from non-admins
  const ADMIN_ONLY_SECTIONS = ["ref-user-roles", "ref-system"];
  const isSectionVisible = (sectionId: string) =>
    showAllTabs || !ADMIN_ONLY_SECTIONS.includes(sectionId);

  // Fetch user role on mount
  useEffect(() => {
    async function fetchRole() {
      try {
        const res = await fetch("/api/auth/sync");
        if (res.ok) {
          const data = await res.json();
          setUserRole(data.role || null);
        }
      } catch {
        // Non-critical — editing buttons just won't show
      }
    }
    fetchRole();
  }, []);

  // Fetch pending suggestion count for admins
  useEffect(() => {
    if (!canEdit) return;
    async function fetchCount() {
      try {
        const res = await fetch("/api/admin/sop/suggestions?count=true");
        if (res.ok) {
          const data = await res.json();
          setPendingSuggestionCount(data.count || 0);
        }
      } catch {
        // Non-critical
      }
    }
    fetchCount();
  }, [canEdit]);

  // Reload section content after edit/suggest
  const handleEditorSave = useCallback(
    (newVersion?: number) => {
      setEditing(false);
      if (activeSectionId) {
        // Re-fetch section content
        fetch(`/api/sop/sections/${activeSectionId}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.section) setSectionContent(data.section);
          })
          .catch(() => {});
      }
      // If it was a suggestion, refresh the count for admins
      if (canEdit) {
        fetch("/api/admin/sop/suggestions?count=true")
          .then((res) => res.json())
          .then((data) => setPendingSuggestionCount(data.count || 0))
          .catch(() => {});
      }
    },
    [activeSectionId, canEdit]
  );

  // Sync state → URL (shallow, no navigation)
  const updateUrl = useCallback(
    (tabId: string, sectionId: string) => {
      const params = new URLSearchParams();
      if (tabId) params.set("tab", tabId);
      if (sectionId) params.set("s", sectionId);
      router.replace(`/sop?${params.toString()}`, { scroll: false });
    },
    [router]
  );

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load tabs on mount, restore URL state if present
  useEffect(() => {
    async function loadTabs() {
      try {
        const res = await fetch("/api/sop/tabs");
        if (!res.ok) throw new Error("Failed to load tabs");
        const data = await res.json();
        setTabs(data.tabs);

        const urlTab = searchParams.get("tab");
        const urlSection = searchParams.get("s");

        // Try to restore from URL params
        if (urlTab && data.tabs.find((t: SopTab) => t.id === urlTab)) {
          setActiveTabId(urlTab);
          const tab = data.tabs.find((t: SopTab) => t.id === urlTab);
          if (urlSection && tab.sections.find((s: SopSectionMeta) => s.id === urlSection)) {
            setActiveSectionId(urlSection);
          } else if (tab.sections.length > 0) {
            setActiveSectionId(tab.sections[0].id);
          }
        } else if (data.tabs.length > 0) {
          const firstTab = data.tabs[0];
          setActiveTabId(firstTab.id);
          if (firstTab.sections.length > 0) {
            setActiveSectionId(firstTab.sections[0].id);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load SOP data");
      } finally {
        setLoading(false);
      }
    }
    loadTabs();
  }, []);

  // Load section content when active section changes
  useEffect(() => {
    if (!activeSectionId) return;
    let cancelled = false;

    async function loadSection() {
      setContentLoading(true);
      try {
        const res = await fetch(`/api/sop/sections/${activeSectionId}`);
        if (!res.ok) throw new Error("Failed to load section");
        const data = await res.json();
        if (!cancelled) {
          setSectionContent(data.section);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load section:", err);
        }
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    }
    loadSection();

    return () => {
      cancelled = true;
    };
  }, [activeSectionId]);

  // Handle cross-section links (data-sop-link)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const link = target.closest("[data-sop-link]") as HTMLElement | null;
      if (!link) return;
      e.preventDefault();

      const targetId = link.getAttribute("data-sop-link");
      if (!targetId) return;

      for (const tab of tabs) {
        const section = tab.sections.find((s) => s.id === targetId);
        if (section) {
          setActiveTabId(tab.id);
          navigateTo(targetId, tab.id);
          return;
        }
      }
    }

    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, [tabs]);

  // Navigate to a section (updates URL too)
  const navigateTo = useCallback(
    (sectionId: string, tabId?: string) => {
      const tab = tabId || activeTabId;
      setActiveSectionId(sectionId);
      setSearchResults(null);
      setSearchQuery("");
      updateUrl(tab, sectionId);
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [activeTabId, updateUrl]
  );

  // Search across all sections
  const handleSearch = useCallback(
    (query: string) => {
      if (!query.trim()) {
        setSearchResults(null);
        return;
      }
      const q = query.toLowerCase();
      const results: SopSectionMeta[] = [];
      for (const tab of tabs) {
        for (const section of tab.sections) {
          if (
            section.title.toLowerCase().includes(q) ||
            section.sidebarGroup.toLowerCase().includes(q)
          ) {
            results.push(section);
          }
        }
      }
      setSearchResults(results);
    },
    [tabs]
  );

  // Guard: redirect to first visible tab if active tab is hidden for this user
  useEffect(() => {
    if (!tabs.length || !activeTabId || loading) return;
    const isVisible = visibleTabs.some((t) => t.id === activeTabId);
    if (!isVisible && visibleTabs.length > 0) {
      const fallback = visibleTabs[0];
      setActiveTabId(fallback.id);
      if (fallback.sections.length > 0) {
        setActiveSectionId(fallback.sections[0].id);
        updateUrl(fallback.id, fallback.sections[0].id);
      }
    }
  }, [activeTabId, visibleTabs, tabs, loading]);

  // Get current tab
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Group sidebar sections by sidebarGroup (filtered by visibility)
  const sidebarGroups = activeTab
    ? activeTab.sections
        .filter((s) => isSectionVisible(s.id))
        .reduce<Record<string, SopSectionMeta[]>>((acc, section) => {
          if (!acc[section.sidebarGroup]) acc[section.sidebarGroup] = [];
          acc[section.sidebarGroup].push(section);
          return acc;
        }, {})
    : {};

  // User display name
  const userName = session?.user?.name || session?.user?.email?.split("@")[0] || "";

  if (loading) {
    return (
      <div className="sop-page sop-shell">
        <div className="sop-loading">Loading SOP Guide...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sop-page sop-shell">
        <div className="sop-error">
          <p>{error}</p>
          <Link href="/">&larr; Back to Home</Link>
        </div>
      </div>
    );
  }

  // Defense-in-depth: sanitize content client-side before rendering
  const sanitizedHtml = sectionContent
    ? sanitizeSopContent(sectionContent.content)
    : "";

  return (
    <div className="sop-page sop-shell">
      {/* ── Top Bar ── */}
      <header className="sop-top-bar">
        <div className="sop-logo">
          <LogoIcon />
          <span>SOP Operations Guide</span>
        </div>

        <div className="sop-search-box" onClick={() => searchInputRef.current?.focus()}>
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search procedures..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              handleSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchQuery("");
                setSearchResults(null);
                searchInputRef.current?.blur();
              }
            }}
          />
          <span className="sop-kbd">Ctrl+K</span>
        </div>

        <div className="sop-top-right">
          {canEdit && pendingSuggestionCount > 0 && (
            <span
              className="sop-suggestion-badge"
              title={`${pendingSuggestionCount} pending suggestion${pendingSuggestionCount !== 1 ? "s" : ""}`}
            >
              {pendingSuggestionCount} pending
            </span>
          )}
          {userName && <span className="sop-user-name">{userName}</span>}
          <span className="sop-version">v3.1 — Updated Mar 2026</span>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="sop-sidebar-toggle"
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            <SidebarIcon open={sidebarOpen} />
          </button>
          <Link href="/" className="sop-home-link">Home</Link>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <nav className="sop-tab-bar">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTabId(tab.id);
              setSearchResults(null);
              setSearchQuery("");
              if (tab.sections.length > 0) {
                navigateTo(tab.sections[0].id, tab.id);
              }
            }}
            className={tab.id === activeTabId ? "active" : ""}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Search Results Overlay ── */}
      {searchResults !== null && (
        <div className="sop-search-results">
          <div className="sop-search-results-header">
            <span>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;</span>
            <button onClick={() => { setSearchResults(null); setSearchQuery(""); }}>
              Clear
            </button>
          </div>
          {searchResults.length === 0 ? (
            <div className="sop-search-empty">No matching sections found.</div>
          ) : (
            <div className="sop-search-list">
              {searchResults.map((section) => (
                <button
                  key={section.id}
                  className="sop-search-item"
                  onClick={() => {
                    // Find and switch to the right tab
                    const targetTab = tabs.find((t) =>
                      t.sections.some((s) => s.id === section.id)
                    );
                    if (targetTab) {
                      setActiveTabId(targetTab.id);
                      navigateTo(section.id, targetTab.id);
                    } else {
                      navigateTo(section.id);
                    }
                  }}
                >
                  <DotIcon color={section.dotColor} />
                  <span className="sop-search-item-title">{section.title}</span>
                  <span className="sop-search-item-group">{section.sidebarGroup}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Main Layout ── */}
      <div className="sop-layout">
        {/* ── Sidebar ── */}
        {sidebarOpen && (
          <nav className="sop-sidebar">
            {Object.entries(sidebarGroups).map(([group, sections]) => (
              <div key={group} className="sop-sidebar-section">
                <div className="sop-sidebar-section-title">{group}</div>
                {sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => navigateTo(section.id)}
                    className={section.id === activeSectionId ? "active" : ""}
                  >
                    <DotIcon color={section.dotColor} />
                    <span>{section.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        )}

        {/* ── Content Area ── */}
        <main ref={contentRef} className="sop-main">
          {contentLoading && !sectionContent ? (
            <div className="sop-loading">Loading section...</div>
          ) : sectionContent ? (
            <>
              {/* Edit/Suggest action bar */}
              {(canEdit || canSuggest) && !editing && (
                <div className="sop-edit-bar">
                  {canEdit && (
                    <button
                      onClick={() => setEditing(true)}
                      className="sop-edit-btn"
                      title="Edit this section"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit
                    </button>
                  )}
                  {canSuggest && (
                    <button
                      onClick={() => setEditing(true)}
                      className="sop-suggest-btn"
                      title="Request a change to this section"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                      </svg>
                      Request Changes
                    </button>
                  )}
                </div>
              )}

              {/* Content — sanitized server-side on write + client-side defense-in-depth */}
              <div
                className="sop-content"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />

              {/* Footer meta */}
              <div className="sop-footer-meta">
                <span>
                  {sectionContent.updatedBy && (
                    <>Last edited by {sectionContent.updatedBy}</>
                  )}
                </span>
                <span>
                  v{sectionContent.version} &middot;{" "}
                  {new Date(sectionContent.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </>
          ) : (
            <div className="sop-loading">Select a section from the sidebar</div>
          )}
        </main>

        {/* ── Editor Overlay ── */}
        {editing && sectionContent && (
          <SopEditor
            sectionId={sectionContent.id}
            sectionTitle={sectionContent.title}
            initialContent={sectionContent.content}
            initialVersion={sectionContent.version}
            mode={canEdit ? "edit" : "suggest"}
            onSave={handleEditorSave}
            onCancel={() => setEditing(false)}
          />
        )}
      </div>
    </div>
  );
}
