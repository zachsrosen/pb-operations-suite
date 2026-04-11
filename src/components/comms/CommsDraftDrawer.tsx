"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  replyTo?: {
    from: string;
    subject: string;
    snippet: string;
    threadId?: string;
    messageId?: string;
  };
}

export default function CommsDraftDrawer({ open, onClose, replyTo }: Props) {
  const [to, setTo] = useState(replyTo?.from || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    replyTo ? `Re: ${replyTo.subject}` : ""
  );
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiProvider, setAiProvider] = useState<string | null>(null);

  if (!open) return null;

  async function handleAiDraft() {
    setAiLoading(true);
    try {
      const resp = await fetch("/api/comms/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalFrom: replyTo?.from || to,
          originalSubject: replyTo?.subject || subject,
          originalSnippet: replyTo?.snippet || "",
        }),
      });
      const data = await resp.json();
      if (data.body) {
        setBody(data.body);
        setAiProvider(data.provider);
      }
    } finally {
      setAiLoading(false);
    }
  }

  async function handleCreateDraft() {
    setSaving(true);
    try {
      const resp = await fetch("/api/comms/draft", {
        method: draftId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draftId ? { draftId } : {}),
          to,
          cc: cc || undefined,
          subject,
          body,
          threadId: replyTo?.threadId,
        }),
      });
      const data = await resp.json();
      if (data.draftId) setDraftId(data.draftId);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendDraft() {
    if (!draftId) return;
    setSending(true);
    try {
      await fetch("/api/comms/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      onClose();
    } finally {
      setSending(false);
    }
  }

  async function handleFeedback(rating: "good" | "needs_work") {
    await fetch("/api/comms/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        draftBody: body,
        originalSubject: subject,
        provider: aiProvider,
      }),
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col bg-surface shadow-card-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-foreground">
            {replyTo ? "Reply" : "New Draft"}
          </h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            &times;
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <input
            placeholder="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          <input
            placeholder="Cc"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          <input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
          />
          <textarea
            placeholder="Compose your email..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none"
          />

          {/* AI feedback */}
          {aiProvider && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">AI draft by {aiProvider}</span>
              <button
                onClick={() => handleFeedback("good")}
                className="rounded bg-green-600/20 px-2 py-1 text-xs text-green-400 hover:bg-green-600/30"
              >
                Good Draft
              </button>
              <button
                onClick={() => handleFeedback("needs_work")}
                className="rounded bg-amber-600/20 px-2 py-1 text-xs text-amber-400 hover:bg-amber-600/30"
              >
                Needs Work
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <button
            onClick={handleAiDraft}
            disabled={aiLoading}
            className="rounded-lg bg-cyan-600/20 px-3 py-2 text-sm text-cyan-400 hover:bg-cyan-600/30 disabled:opacity-50"
          >
            {aiLoading ? "Generating..." : "AI Draft"}
          </button>
          <button
            onClick={handleCreateDraft}
            disabled={saving || !to || !subject}
            className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-foreground hover:bg-surface disabled:opacity-50"
          >
            {saving ? "Saving..." : draftId ? "Update Draft" : "Create Draft"}
          </button>
          {draftId && (
            <>
              <button
                onClick={handleSendDraft}
                disabled={sending}
                className="rounded-lg bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-700 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send Draft"}
              </button>
              <a
                href="https://mail.google.com/mail/u/0/#drafts"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted hover:text-foreground"
              >
                Open in Gmail
              </a>
            </>
          )}
        </div>
      </div>
    </>
  );
}
