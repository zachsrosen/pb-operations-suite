"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import type { ModeReason, SolarMode } from "@/lib/solar/native-mode";

interface Project {
  id: string;
  name: string;
  address: string | null;
  status: string;
  visibility: string;
  version: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy: { name: string | null; email: string };
}

interface ProjectBrowserProps {
  onOpenClassic: (projectId?: string) => void;
  onStartWizard: (draftId?: string) => void;
  onRunAnalysis?: (projectId: string) => void;
  serverDefault: SolarMode;
  modeReason: ModeReason;
  source: "initial" | "toggle";
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  ACTIVE: "bg-green-500/15 text-green-400 border-green-500/30",
  ARCHIVED: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export default function ProjectBrowser({
  onOpenClassic,
  onStartWizard,
  onRunAnalysis,
  serverDefault,
  modeReason,
  source,
}: ProjectBrowserProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { trackFeature } = useActivityTracking();
  const tracked = useRef(false);

  // Track view once on mount
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackFeature("solar_native_view", undefined, {
      serverDefault,
      modeReason,
      forceClassicLocked: modeReason === "env_force_classic",
      source,
    });
  }, [trackFeature, serverDefault, modeReason, source]);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/solar/projects?limit=50");

      // Expired session → redirect to login
      if (res.status === 401) {
        window.location.href = "/login?callbackUrl=/dashboards/solar-surveyor";
        return;
      }

      if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
      const json = await res.json();
      setProjects(json.data ?? []);
      trackFeature("solar_projects_loaded", undefined, {
        count: json.data?.length ?? 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      trackFeature("solar_projects_error", undefined, { error: msg });
    } finally {
      setLoading(false);
    }
  }, [trackFeature]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleProjectOpen = useCallback(
    (projectId: string) => {
      trackFeature("solar_project_open", undefined, { projectId });
      onOpenClassic(projectId);
    },
    [trackFeature, onOpenClassic]
  );

  const handleNewProject = useCallback(() => {
    trackFeature("solar_wizard_started", undefined, { source: "header" });
    onStartWizard();
  }, [trackFeature, onStartWizard]);

  const handleResumeDraft = useCallback(
    (draftId: string) => {
      trackFeature("solar_wizard_started", undefined, {
        source: "resume",
        draftId,
      });
      onStartWizard(draftId);
    },
    [trackFeature, onStartWizard]
  );

  const handleDelete = useCallback(
    async (projectId: string, projectName: string) => {
      const confirmed = window.confirm(
        `Archive "${projectName}"? This will hide it from your project list.`
      );
      if (!confirmed) return;

      try {
        const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
        const csrf = csrfMatch?.[1] ?? "";

        const res = await fetch(`/api/solar/projects/${projectId}`, {
          method: "DELETE",
          headers: { "x-csrf-token": csrf },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Delete failed (${res.status})`);
        }

        trackFeature("solar_project_archived", undefined, { projectId });
        // Remove from local list
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to archive project");
      }
    },
    [trackFeature]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted">
          Your solar simulation projects. Open a project in Classic to run
          analysis.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleNewProject}
            aria-label="Create new solar project"
            className="px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors text-sm font-medium"
          >
            New Project
          </button>
          <button
            onClick={() => onOpenClassic()}
            className="hidden sm:inline-flex px-4 py-2 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/30 hover:bg-orange-500/20 transition-colors text-sm font-medium"
          >
            Open Classic Workspace
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-orange-500 border-t-transparent rounded-full" />
          <span className="ml-3 text-sm text-muted">Loading projects...</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={fetchProjects}
            className="mt-2 text-xs text-red-300 hover:text-red-200 underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && projects.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <div className="text-4xl opacity-30">&#9788;</div>
          <p className="text-muted text-sm">No projects yet</p>
          <p className="text-muted/60 text-xs max-w-md mx-auto">
            Create your first solar simulation project with the guided setup
            wizard.
          </p>
          <button
            onClick={() => {
              trackFeature("solar_wizard_started", undefined, {
                source: "empty_state",
              });
              onStartWizard();
            }}
            className="mt-4 px-4 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors text-sm font-medium"
          >
            Create Your First Project
          </button>
        </div>
      )}

      {/* Project grid */}
      {!loading && !error && projects.length > 0 && (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
          role="list"
          aria-label="Solar projects"
        >
          {projects.map((project) => (
            <article
              key={project.id}
              role="listitem"
              className="rounded-lg border border-t-border bg-card p-3 sm:p-4 hover:border-orange-500/40 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-medium text-foreground truncate pr-2">
                  {project.name}
                </h3>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                    STATUS_STYLES[project.status] ?? STATUS_STYLES.DRAFT
                  }`}
                  aria-label={`Status: ${project.status.toLowerCase()}`}
                >
                  {project.status}
                </span>
              </div>

              {project.address && (
                <p className="text-xs text-muted truncate mb-3">
                  {project.address}
                </p>
              )}

              <div className="flex items-center justify-between text-[11px] text-muted/60">
                <span>
                  {project.createdBy.name ?? project.createdBy.email}
                </span>
                <span>{relativeTime(project.updatedAt)}</span>
              </div>

              <div className="mt-3 pt-3 border-t border-t-border flex flex-wrap items-center gap-2 sm:gap-3">
                {project.status === "DRAFT" ? (
                  <button
                    onClick={() => handleResumeDraft(project.id)}
                    className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/50 rounded"
                  >
                    Resume Draft &rarr;
                  </button>
                ) : (
                  <>
                    {onRunAnalysis && (
                      <button
                        onClick={() => onRunAnalysis(project.id)}
                        className="text-xs text-green-400 hover:text-green-300 transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/50 rounded"
                      >
                        Run Analysis &rarr;
                      </button>
                    )}
                    <button
                      onClick={() => handleProjectOpen(project.id)}
                      className="text-xs text-orange-400 hover:text-orange-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50 rounded"
                    >
                      Open in Classic &rarr;
                    </button>
                  </>
                )}
                <button
                  onClick={() => handleDelete(project.id, project.name)}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 rounded ml-auto"
                  aria-label={`Archive ${project.name}`}
                  title="Archive project"
                >
                  &#x2715;
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
