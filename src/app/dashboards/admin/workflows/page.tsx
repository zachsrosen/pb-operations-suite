"use client";

/**
 * Admin Workflows — list page.
 *
 * Lists all workflows with quick actions: new, edit, archive, delete.
 * ADMIN only (enforced by middleware + /api/admin prefix).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import DashboardShell from "@/components/DashboardShell";

interface WorkflowListItem {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  triggerType: "MANUAL" | "HUBSPOT_PROPERTY_CHANGE" | "ZUPER_PROPERTY_CHANGE";
  createdAt: string;
  updatedAt: string;
  createdBy: { email: string; name: string | null };
  _count: { runs: number };
}

interface TemplateItem {
  slug: string;
  name: string;
  summary: string;
  useCase: string;
  triggerType: string;
  stepCount: number;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-zinc-500/20 text-zinc-300",
  ACTIVE: "bg-green-500/20 text-green-300",
  ARCHIVED: "bg-amber-500/20 text-amber-300",
};

export default function AdminWorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/workflows");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setWorkflows(data.workflows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createNew() {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Untitled workflow",
          triggerType: "MANUAL",
          triggerConfig: {},
          definition: { steps: [] },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      router.push(`/dashboards/admin/workflows/${data.workflow.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  async function openTemplates() {
    setTemplatesOpen(true);
    if (templates) return;
    try {
      const res = await fetch("/api/admin/workflows/templates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(data.templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createFromTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch("/api/admin/workflows/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      router.push(`/dashboards/admin/workflows/${data.workflow.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  async function archiveOne(id: string) {
    if (!confirm("Archive this workflow? It will stop receiving trigger events.")) return;
    await fetch(`/api/admin/workflows/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    });
    await load();
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this workflow permanently? This also deletes its run history.")) return;
    await fetch(`/api/admin/workflows/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <DashboardShell title="Admin Workflows" accentColor="purple">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted">
            Compose workflows from existing integrations. Triggers fire on HubSpot / Zuper events or on manual runs.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={openTemplates}
              className="rounded-md border border-t-border bg-surface hover:bg-surface-2 px-4 py-2 text-sm font-medium transition"
            >
              Start from template
            </button>
            <button
              onClick={createNew}
              disabled={creating}
              className="rounded-md bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2 text-sm text-white font-medium transition"
            >
              {creating ? "Creating..." : "+ Blank workflow"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {workflows == null ? (
          <div className="text-muted text-sm">Loading…</div>
        ) : workflows.length === 0 ? (
          <div className="rounded-md border border-t-border bg-surface px-6 py-10 text-center text-muted">
            <p className="text-sm">No workflows yet.</p>
            <p className="mt-1 text-xs">Click &quot;+ New workflow&quot; to create one.</p>
          </div>
        ) : (
          <div className="rounded-md border border-t-border bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Trigger</th>
                  <th className="text-left px-4 py-3">Runs</th>
                  <th className="text-left px-4 py-3">Updated</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border">
                {workflows.map((w) => (
                  <tr key={w.id} className="hover:bg-surface-2 transition">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboards/admin/workflows/${w.id}`}
                        className="text-foreground hover:text-purple-400 font-medium"
                      >
                        {w.name}
                      </Link>
                      {w.description && (
                        <p className="text-xs text-muted mt-0.5 line-clamp-1">{w.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded ${STATUS_COLORS[w.status]}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{w.triggerType}</td>
                    <td className="px-4 py-3 text-xs text-muted">{w._count.runs}</td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {new Date(w.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs space-x-2">
                      <Link
                        href={`/dashboards/admin/workflows/${w.id}`}
                        className="text-purple-400 hover:text-purple-300"
                      >
                        Edit
                      </Link>
                      {w.status !== "ARCHIVED" && (
                        <button
                          onClick={() => archiveOne(w.id)}
                          className="text-amber-400 hover:text-amber-300"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => deleteOne(w.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {templatesOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setTemplatesOpen(false)}
          >
            <div
              className="bg-surface border border-t-border rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-t-border px-6 py-4">
                <h3 className="text-lg font-semibold">Start from template</h3>
                <button
                  onClick={() => setTemplatesOpen(false)}
                  className="text-muted hover:text-foreground text-xl leading-none"
                >
                  ×
                </button>
              </div>
              <div className="p-6 space-y-3">
                {templates == null ? (
                  <p className="text-muted text-sm">Loading templates…</p>
                ) : templates.length === 0 ? (
                  <p className="text-muted text-sm">No templates available.</p>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.slug}
                      onClick={() => createFromTemplate(t.slug)}
                      disabled={creating}
                      className="w-full text-left rounded-md border border-t-border bg-surface-2 hover:bg-surface-elevated disabled:opacity-50 px-4 py-3 transition"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-foreground">{t.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted shrink-0">
                          <span className="px-2 py-0.5 rounded bg-surface-elevated">{t.triggerType}</span>
                          <span>{t.stepCount} step{t.stepCount === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted mt-1">{t.summary}</p>
                      <p className="text-xs text-zinc-500 mt-1 italic">{t.useCase}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
