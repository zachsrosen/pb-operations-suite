"use client";

import { useEffect, useState } from "react";
import type { ShitShowItem, ShitShowAssignment } from "./types";

interface UserOption {
  id: string;
  email: string;
  name: string | null;
}

export function AssignmentsPanel({
  item,
  onChanged,
}: {
  item: ShitShowItem;
  onChanged: () => Promise<void>;
}) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [assigneeUserId, setAssigneeUserId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [actionText, setActionText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/shit-show-meeting/users")
      .then((r) => r.json())
      .then((j: { users: UserOption[] }) => setUsers(j.users ?? []))
      .catch(() => {});
  }, []);

  async function submit() {
    if (!assigneeUserId || !actionText.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`/api/shit-show-meeting/items/${item.id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeUserId,
          dueDate: dueDate || null,
          actionText,
        }),
      });
      setAssigneeUserId("");
      setDueDate("");
      setActionText("");
      setAdding(false);
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: string, status: "OPEN" | "COMPLETED" | "CANCELLED") {
    await fetch(`/api/shit-show-meeting/assignments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await onChanged();
  }

  const userMap = new Map(users.map((u) => [u.id, u]));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs uppercase tracking-wider text-muted">
          Follow-ups ({item.assignments.length})
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          className="text-xs text-orange-400 hover:text-orange-300"
        >
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      {adding && (
        <div className="space-y-2 mb-2 p-2 bg-surface-2 rounded">
          <select
            value={assigneeUserId}
            onChange={(e) => setAssigneeUserId(e.target.value)}
            className="w-full bg-surface border border-t-border rounded px-2 py-1 text-sm"
          >
            <option value="">Pick assignee…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-surface border border-t-border rounded px-2 py-1 text-sm"
          />
          <textarea
            value={actionText}
            onChange={(e) => setActionText(e.target.value)}
            rows={2}
            placeholder="What needs to happen?"
            className="w-full bg-surface border border-t-border rounded px-2 py-1 text-sm"
          />
          <button
            onClick={submit}
            disabled={!assigneeUserId || !actionText.trim() || submitting}
            className="bg-red-600 hover:bg-red-500 text-white text-xs px-3 py-1 rounded disabled:opacity-50"
          >
            Add follow-up
          </button>
        </div>
      )}

      <div className="space-y-1">
        {item.assignments.map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            assigneeName={userMap.get(a.assigneeUserId)?.name ?? userMap.get(a.assigneeUserId)?.email ?? a.assigneeUserId}
            onStatus={(status) => setStatus(a.id, status)}
          />
        ))}
        {item.assignments.length === 0 && !adding && (
          <div className="text-xs text-muted italic">No follow-ups yet.</div>
        )}
      </div>
    </div>
  );
}

function AssignmentRow({
  assignment,
  assigneeName,
  onStatus,
}: {
  assignment: ShitShowAssignment;
  assigneeName: string;
  onStatus: (s: "OPEN" | "COMPLETED" | "CANCELLED") => Promise<void>;
}) {
  const isOpen = assignment.status === "OPEN";
  return (
    <div className={`flex items-start gap-2 p-2 rounded ${isOpen ? "bg-surface-2" : "bg-surface-2/50 opacity-60"}`}>
      <input
        type="checkbox"
        checked={!isOpen}
        onChange={() => onStatus(isOpen ? "COMPLETED" : "OPEN")}
        className="mt-0.5"
      />
      <div className="flex-1 text-xs">
        <div className={`text-foreground ${assignment.status === "COMPLETED" ? "line-through" : ""}`}>
          {assignment.actionText}
        </div>
        <div className="text-muted mt-0.5">
          {assigneeName}
          {assignment.dueDate && ` · due ${new Date(assignment.dueDate).toLocaleDateString()}`}
          {assignment.taskSyncStatus === "FAILED" && " · ⚠ HubSpot task sync failed"}
          {assignment.taskSyncStatus === "SYNCED" && " · ✓ HubSpot task created"}
        </div>
      </div>
      {isOpen && (
        <button
          onClick={() => onStatus("CANCELLED")}
          className="text-xs text-muted hover:text-red-400"
          title="Cancel"
        >
          ×
        </button>
      )}
    </div>
  );
}
