"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";

interface QueueRow {
  id: string;
  queueId: string;
  name: string;
  updatedAt: string;
}

export default function HubspotQueuesAdminPage() {
  const [queues, setQueues] = useState<QueueRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newQueueId, setNewQueueId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await fetch("/api/admin/hubspot-queues");
      if (!r.ok) throw new Error(`status ${r.status}`);
      const d = (await r.json()) as { queues: QueueRow[] };
      setQueues(d.queues);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (queueId: string, name: string) => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/hubspot-queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId, name }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || `status ${r.status}`);
      }
      await load();
      setNewQueueId("");
      setNewName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (queueId: string) => {
    if (!confirm(`Remove mapping for queue #${queueId}?`)) return;
    setSaving(true);
    try {
      await fetch(`/api/admin/hubspot-queues?queueId=${encodeURIComponent(queueId)}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AdminPageHeader
        title="HubSpot Queue Names"
        subtitle="HubSpot doesn't expose task queues via their public API. Map each queue ID (copy the number from the queue's URL in HubSpot) to a display name. These names show up everywhere the My Tasks page surfaces queues."
      />

      {err && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {err}
        </div>
      )}

      {/* Add form */}
      <section className="mt-4 rounded-lg border border-t-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Add or update a queue</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-muted">Queue ID</span>
            <input
              type="text"
              value={newQueueId}
              onChange={(e) => setNewQueueId(e.target.value)}
              placeholder="e.g. 6345678"
              className="mt-1 w-40 rounded border border-t-border bg-background px-3 py-1.5 font-mono text-sm text-foreground focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="block flex-1 min-w-[240px]">
            <span className="text-[10px] uppercase tracking-wide text-muted">Display name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Design follow-ups"
              className="mt-1 w-full rounded border border-t-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={saving || !newQueueId.trim() || !newName.trim()}
            onClick={() => save(newQueueId.trim(), newName.trim())}
            className="rounded bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      {/* Existing mappings */}
      <section className="mt-4">
        {queues === null ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : queues.length === 0 ? (
          <p className="rounded-lg border border-t-border bg-surface p-4 text-sm text-muted">
            No queue mappings yet. Add one above.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-t-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Queue ID</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Updated</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-t-border bg-surface">
                {queues.map((q) => (
                  <QueueRowItem key={q.id} row={q} onSave={save} onRemove={remove} saving={saving} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function QueueRowItem({
  row,
  onSave,
  onRemove,
  saving,
}: {
  row: QueueRow;
  onSave: (queueId: string, name: string) => Promise<void>;
  onRemove: (queueId: string) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState(row.name);
  const dirty = name.trim() !== row.name;

  return (
    <tr>
      <td className="px-3 py-2 font-mono text-xs text-muted">#{row.queueId}</td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-t-border bg-background px-2 py-1 text-sm text-foreground focus:border-blue-500 focus:outline-none"
        />
      </td>
      <td className="px-3 py-2 text-xs text-muted">
        {new Date(row.updatedAt).toLocaleDateString()}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-2">
          {dirty && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSave(row.queueId, name.trim())}
              className="rounded bg-blue-500 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
            >
              Save
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => onRemove(row.queueId)}
            className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  );
}
