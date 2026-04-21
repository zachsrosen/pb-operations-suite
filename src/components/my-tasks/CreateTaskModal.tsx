"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskPriority, TaskType } from "@/lib/hubspot-tasks";
import TypeaheadPicker, { type TypeaheadValue } from "./TypeaheadPicker";

export interface CreateTaskInput {
  subject: string;
  body?: string;
  dueAt?: string;
  priority?: TaskPriority;
  type?: TaskType;
  dealId?: string;
  ticketId?: string;
  contactId?: string;
}

export interface CreateTaskModalProps {
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => Promise<void>;
  /** Optional pre-filled values, e.g. from the Deal Detail Panel "+ New task" */
  prefill?: {
    deal?: TypeaheadValue;
    contact?: TypeaheadValue;
    ticket?: TypeaheadValue;
  };
}

export default function CreateTaskModal({ onClose, onCreate, prefill }: CreateTaskModalProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority | "">("");
  const [type, setType] = useState<TaskType | "">("TODO");
  const [deal, setDeal] = useState<TypeaheadValue | null>(prefill?.deal ?? null);
  const [ticket, setTicket] = useState<TypeaheadValue | null>(prefill?.ticket ?? null);
  const [contact, setContact] = useState<TypeaheadValue | null>(prefill?.contact ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    subjectRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setError(null);
    if (!subject.trim()) {
      setError("Subject is required");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        subject: subject.trim(),
        body: body.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        priority: priority || undefined,
        type: type || undefined,
        dealId: deal?.id,
        ticketId: ticket?.id,
        contactId: contact?.id,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New task"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-lg border border-t-border bg-surface-elevated p-5 shadow-card-lg">
        <h2 className="text-lg font-semibold text-foreground">New task</h2>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs text-muted">Subject *</span>
            <input
              ref={subjectRef}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Call customer, email vendor, etc."
              className="mt-1 w-full rounded border border-t-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted">Notes</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-t-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted">Due</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TaskType | "")}
                className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
              >
                <option value="TODO">To-do</option>
                <option value="CALL">Call</option>
                <option value="EMAIL">Email</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted">Priority</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority | "")}
                className="mt-1 w-full rounded border border-t-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
              >
                <option value="">—</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </label>
            <div />
          </div>

          <details open={Boolean(prefill?.deal || prefill?.contact || prefill?.ticket)}>
            <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
              Link to a deal, contact, or ticket
            </summary>
            <div className="mt-2 space-y-3">
              <TypeaheadPicker
                type="deal"
                label="Deal"
                placeholder="Search by name…"
                value={deal}
                onChange={setDeal}
              />
              <TypeaheadPicker
                type="contact"
                label="Contact"
                placeholder="Search by name or email…"
                value={contact}
                onChange={setContact}
              />
              <TypeaheadPicker
                type="ticket"
                label="Ticket"
                placeholder="Search by subject…"
                value={ticket}
                onChange={setTicket}
              />
            </div>
          </details>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-t-border bg-surface px-3 py-1.5 text-sm text-foreground hover:bg-surface-2"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !subject.trim()}
            className="rounded bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}
