"use client";

import Link from "next/link";
import { useState, useRef, useCallback, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DealSearchResult {
  id: string;
  name: string;
  stage: string;
  pbLocation: string;
}

interface Finding {
  check: string;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string;
}

interface InstallFinding {
  category: string;
  status: "pass" | "fail" | "unable_to_verify";
  planset_spec: string;
  observed: string;
  notes: string;
}

interface Anomaly {
  project_id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const MODEL_BADGE =
  "inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300";

const CARD =
  "rounded-xl border border-t-border/80 bg-surface p-5 transition-all hover:border-purple-500/50 flex flex-col";

const ICON_BOX =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-purple-500/25 bg-purple-500/10";

const BTN =
  "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";

const BTN_PRIMARY = `${BTN} bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed`;

const BTN_GHOST = `${BTN} text-purple-300 hover:text-purple-200 hover:bg-purple-500/10`;

const SEVERITY_COLORS: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  info: "border-blue-500/40 bg-blue-500/10 text-blue-300",
};

const STATUS_COLORS: Record<string, string> = {
  pass: "text-emerald-400",
  fail: "text-red-400",
  unable_to_verify: "text-amber-400",
};

// ---------------------------------------------------------------------------
// Icons (inline SVGs)
// ---------------------------------------------------------------------------

function BomIcon() {
  return (
    <svg className="h-5 w-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h8M8 10h8M8 14h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg className="h-5 w-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l2.7 5.47L21 9.27l-4.5 4.39 1.06 6.18L12 16.9l-5.56 2.94 1.06-6.18L3 9.27l6.3-.8L12 3z" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg className="h-5 w-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-4.5-4.5a1.8 1.8 0 00-2.54 0L8 16.5" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg className="h-5 w-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 9h10M7 13h7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-6l-4 4v-4H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg className="h-5 w-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.3 3.6L2.5 17a2 2 0 001.74 3h15.52A2 2 0 0021.5 17L13.7 3.6a2 2 0 00-3.4 0z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg className="h-5 w-5 text-purple-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 20l-3.5-3.5" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-purple-300" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Card wrapper
// ---------------------------------------------------------------------------

function SkillCard({
  icon,
  name,
  model,
  description,
  children,
}: {
  icon: ReactNode;
  name: string;
  model: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={CARD}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className={ICON_BOX}>{icon}</div>
        <span className={MODEL_BADGE}>{model}</span>
      </div>
      <h2 className="text-base font-semibold text-foreground">{name}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deal search (shared)
// ---------------------------------------------------------------------------

function DealSearch({
  selected,
  onSelect,
}: {
  selected: DealSearchResult | null;
  onSelect: (deal: DealSearchResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/projects?context=executive&search=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      const projects = (data.projects ?? data.data ?? []).slice(0, 8);
      setResults(
        projects.map((p: Record<string, string>) => ({
          id: p.id ?? p.dealId,
          name: p.name ?? p.dealName ?? p.dealname,
          stage: p.stage ?? p.dealStage ?? "",
          pbLocation: p.pbLocation ?? p.pb_location ?? "",
        }))
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2">
        <span className="flex-1 truncate text-sm text-foreground">{selected.name}</span>
        <button
          onClick={() => onSelect(null)}
          className="text-xs text-muted hover:text-foreground"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search deals (PROJ-XXXX or name)..."
        className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-purple-500/50 focus:outline-none"
      />
      {searching && (
        <div className="absolute right-3 top-2.5">
          <Spinner />
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-t-border bg-surface-elevated shadow-card-lg">
          {results.map((deal) => (
            <button
              key={deal.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(deal);
                setQuery("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-purple-500/10"
            >
              <span className="flex-1 truncate text-foreground">{deal.name}</span>
              <span className="shrink-0 text-xs text-muted">{deal.stage}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. BOM Extraction Card
// ---------------------------------------------------------------------------

function BomCard({ selectedDeal }: { selectedDeal: DealSearchResult | null }) {
  return (
    <SkillCard icon={<BomIcon />} name="BOM Extraction" model="Opus 4.5" description="Extract bill of materials from planset PDFs.">
      {selectedDeal ? (
        <Link href={`/dashboards/bom?deal=${selectedDeal.id}`} className={BTN_PRIMARY}>
          Open BOM Tool <span className="ml-1">→</span>
        </Link>
      ) : (
        <p className="text-xs text-muted">Select a deal above to open the BOM tool.</p>
      )}
    </SkillCard>
  );
}

// ---------------------------------------------------------------------------
// 2. Design Review Card
// ---------------------------------------------------------------------------

function DesignReviewCard({ selectedDeal }: { selectedDeal: DealSearchResult | null }) {
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [passed, setPassed] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState("");

  async function pollStatus(reviewId: string) {
    const maxAttempts = 100; // ~5 minutes at 3s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/reviews/status/${reviewId}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status === "completed") {
          setFindings(data.findings ?? []);
          setPassed(data.passed ?? false);
          setDurationMs(data.durationMs ?? 0);
          setStatus("completed");
          return;
        }
        if (data.status === "failed") {
          setError(data.error ?? "Review failed");
          setStatus("failed");
          return;
        }
      } catch {
        // Retry on network error
      }
    }
    setError("Review timed out");
    setStatus("failed");
  }

  async function runReview() {
    if (!selectedDeal) return;
    setStatus("running");
    setFindings([]);
    setError("");
    try {
      const res = await fetch("/api/reviews/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: selectedDeal.id, skill: "design-review" }),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Already running — attach to existing
        pollStatus(data.existingReviewId);
      } else if (res.ok) {
        pollStatus(data.id);
      } else {
        setError(data.error ?? "Failed to start review");
        setStatus("failed");
      }
    } catch {
      setError("Network error");
      setStatus("failed");
    }
  }

  return (
    <SkillCard icon={<StarIcon />} name="Design Review" model="Sonnet" description="AI compliance review against AHJ + utility requirements.">
      {!selectedDeal && <p className="text-xs text-muted">Select a deal above to run a design review.</p>}
      {selectedDeal && status === "idle" && (
        <button onClick={runReview} className={BTN_PRIMARY}>Run Design Review</button>
      )}
      {status === "running" && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Reviewing... this may take a few minutes.
        </div>
      )}
      {status === "failed" && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={runReview} className={BTN_GHOST}>Retry</button>
        </div>
      )}
      {status === "completed" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${passed ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
              {passed ? "PASSED" : "FAILED"}
            </span>
            <span className="text-xs text-muted">{(durationMs / 1000).toFixed(1)}s</span>
          </div>
          {findings.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {findings.map((f, i) => (
                <div key={i} className={`rounded-lg border px-3 py-1.5 text-xs ${SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.info}`}>
                  <span className="font-medium">{f.severity.toUpperCase()}</span>: {f.message}
                </div>
              ))}
            </div>
          )}
          {findings.length === 0 && <p className="text-xs text-muted">No issues found.</p>}
          <button onClick={() => setStatus("idle")} className={BTN_GHOST}>Run Again</button>
        </div>
      )}
    </SkillCard>
  );
}

// ---------------------------------------------------------------------------
// 3. Install Photo Review Card
// ---------------------------------------------------------------------------

function InstallReviewCard({ selectedDeal }: { selectedDeal: DealSearchResult | null }) {
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [findings, setFindings] = useState<InstallFinding[]>([]);
  const [overallPass, setOverallPass] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  async function runReview() {
    if (!selectedDeal) return;
    setStatus("running");
    setFindings([]);
    setError("");
    try {
      const res = await fetch("/api/install-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: selectedDeal.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setFindings(data.findings ?? []);
        setOverallPass(data.overall_pass ?? false);
        setSummary(data.summary ?? "");
        setStatus("completed");
      } else {
        setError(data.error ?? "Review failed");
        setStatus("failed");
      }
    } catch {
      setError("Network error");
      setStatus("failed");
    }
  }

  return (
    <SkillCard icon={<CameraIcon />} name="Install Photo Review" model="Sonnet" description="Compare install photos to permitted planset.">
      {!selectedDeal && <p className="text-xs text-muted">Select a deal above to run an install review.</p>}
      {selectedDeal && status === "idle" && (
        <button onClick={runReview} className={BTN_PRIMARY}>Run Install Review</button>
      )}
      {status === "running" && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Comparing photos... this may take up to 2 minutes.
        </div>
      )}
      {status === "failed" && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={runReview} className={BTN_GHOST}>Retry</button>
        </div>
      )}
      {status === "completed" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${overallPass ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
              {overallPass ? "PASS" : "FAIL"}
            </span>
          </div>
          {summary && <p className="text-xs text-muted">{summary}</p>}
          {findings.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-t-border/50 bg-surface-2 px-3 py-1.5 text-xs">
                  <span className={`font-medium uppercase ${STATUS_COLORS[f.status] ?? "text-muted"}`}>{f.status.replace(/_/g, " ")}</span>
                  <span className="text-foreground">{f.category}</span>
                  {f.notes && <span className="text-muted">— {f.notes}</span>}
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setStatus("idle")} className={BTN_GHOST}>Run Again</button>
        </div>
      )}
    </SkillCard>
  );
}

// ---------------------------------------------------------------------------
// 4. Chat Assistant Card
// ---------------------------------------------------------------------------

function ChatCard() {
  function openChat() {
    window.dispatchEvent(new Event("open-chat-widget"));
  }

  return (
    <SkillCard icon={<ChatIcon />} name="Chat Assistant" model="Sonnet / Haiku" description="Conversational AI for deal and project questions.">
      <button onClick={openChat} className={BTN_PRIMARY}>
        Open Chat <span className="ml-1">→</span>
      </button>
    </SkillCard>
  );
}

// ---------------------------------------------------------------------------
// 5. Anomaly Detection Card
// ---------------------------------------------------------------------------

function AnomalyCard() {
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [summary, setSummary] = useState("");
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setStatus("running");
    setError("");
    try {
      const res = await fetch("/api/ai/anomalies", { method: "POST" });
      const data = await res.json();
      if (data.error === true && data.anomalies?.length === 0) {
        setError(data.summary ?? "Analysis unavailable");
        setStatus("done");
        return;
      }
      setAnomalies(data.anomalies ?? []);
      setSummary(data.summary ?? "");
      setCached(data.cached ?? false);
      setStatus("done");
    } catch {
      setError("Network error");
      setStatus("done");
    }
  }

  return (
    <SkillCard icon={<AlertIcon />} name="Anomaly Detection" model="Haiku" description="Identify operational anomalies in the project pipeline.">
      {status === "idle" && (
        <button onClick={run} className={BTN_PRIMARY}>Run Analysis</button>
      )}
      {status === "running" && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Analyzing pipeline...
        </div>
      )}
      {status === "done" && (
        <div className="space-y-2">
          {error && <p className="text-sm text-red-400">{error}</p>}
          {cached && <p className="text-xs text-muted italic">Cached result (refreshes every 15 min)</p>}
          {summary && !error && <p className="text-xs text-muted">{summary}</p>}
          {anomalies.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {anomalies.map((a, i) => (
                <div key={i} className={`rounded-lg border px-3 py-1.5 text-xs ${SEVERITY_COLORS[a.severity] ?? SEVERITY_COLORS.info}`}>
                  <div className="font-medium">{a.title}</div>
                  <div className="mt-0.5 opacity-80">{a.reason}</div>
                </div>
              ))}
            </div>
          )}
          {!error && anomalies.length === 0 && <p className="text-xs text-muted">No anomalies detected.</p>}
          <button onClick={() => setStatus("idle")} className={BTN_GHOST}>Run Again</button>
        </div>
      )}
    </SkillCard>
  );
}

// ---------------------------------------------------------------------------
// 6. NL Query Card
// ---------------------------------------------------------------------------

function NLQueryCard() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [interpreted, setInterpreted] = useState("");
  const [filterParams, setFilterParams] = useState("");
  const [error, setError] = useState("");

  async function run() {
    if (!query.trim()) return;
    setStatus("running");
    setError("");
    try {
      const res = await fetch("/api/ai/nl-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Query failed");
        setStatus("done");
        return;
      }
      const spec = data.spec ?? {};
      setInterpreted(spec.interpreted_as ?? "Parsed successfully");
      // Build URL params from spec for pipeline link
      const params = new URLSearchParams();
      if (spec.locations?.length) params.set("locations", spec.locations.join(","));
      if (spec.stages?.length) params.set("stages", spec.stages.join(","));
      if (spec.is_overdue) params.set("overdue", "true");
      if (spec.sort_by) params.set("sort", spec.sort_by);
      if (spec.sort_dir) params.set("dir", spec.sort_dir);
      setFilterParams(params.toString());
      setStatus("done");
    } catch {
      setError("Network error");
      setStatus("done");
    }
  }

  return (
    <SkillCard icon={<SearchIcon />} name="NL Query" model="Haiku" description="Parse plain English into project filters.">
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. overdue projects in Westminster"
            className="flex-1 rounded-lg border border-t-border bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-purple-500/50 focus:outline-none"
          />
          <button onClick={run} disabled={!query.trim() || status === "running"} className={BTN_PRIMARY}>
            {status === "running" ? <Spinner /> : "Search"}
          </button>
        </div>
        {status === "done" && error && <p className="text-sm text-red-400">{error}</p>}
        {status === "done" && !error && (
          <div className="space-y-2">
            <p className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-1.5 text-xs text-purple-200">
              {interpreted}
            </p>
            <Link
              href={`/dashboards/pipeline${filterParams ? `?${filterParams}` : ""}`}
              className={BTN_GHOST}
            >
              View in Pipeline <span className="ml-1">→</span>
            </Link>
          </div>
        )}
      </div>
    </SkillCard>
  );
}

// ---------------------------------------------------------------------------
// Main hub
// ---------------------------------------------------------------------------

export default function AISkillsHub() {
  const [selectedDeal, setSelectedDeal] = useState<DealSearchResult | null>(null);

  return (
    <div className="space-y-6">
      {/* Deal search — shared across BOM, Design Review, Install Review */}
      <div className="rounded-xl border border-t-border/80 bg-surface p-4">
        <label className="mb-2 block text-sm font-medium text-foreground">Select a Deal</label>
        <DealSearch selected={selectedDeal} onSelect={setSelectedDeal} />
        {selectedDeal && (
          <p className="mt-2 text-xs text-muted">
            {selectedDeal.stage} · {selectedDeal.pbLocation || "No location"}
          </p>
        )}
      </div>

      {/* Skill cards grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-grid">
        <BomCard selectedDeal={selectedDeal} />
        <DesignReviewCard selectedDeal={selectedDeal} />
        <InstallReviewCard selectedDeal={selectedDeal} />
        <ChatCard />
        <AnomalyCard />
        <NLQueryCard />
      </div>
    </div>
  );
}
