"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ACCENTS, type Accent } from "./accents";

/**
 * Post a message to the deal's Vishtik project chat. The Vishtik project id is
 * resolved server-side from the deal, so this only sends the message text.
 * When dryRun is on, a banner makes clear nothing actually posts.
 */
export function SendToVishtikDialog({
  dealId,
  dealName,
  accent,
  dryRun,
  onClose,
}: {
  dealId: string;
  dealName: string;
  accent: Accent;
  dryRun: boolean;
  onClose: () => void;
}) {
  const a = ACCENTS[accent];
  const [message, setMessage] = useState("");
  const [sentDryRun, setSentDryRun] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/design-hub/vishtik/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, message: message.trim() }),
      });
      const body = (await r.json().catch(() => null)) as {
        error?: string;
        dryRun?: boolean;
      } | null;
      if (!r.ok) throw new Error(body?.error ?? "Send failed");
      return body;
    },
    onSuccess: (body) => {
      // On a real send, close. On a dry-run, keep the dialog open with a clear
      // "nothing was posted" confirmation so it can't be mistaken for a send.
      if (body?.dryRun) setSentDryRun(true);
      else onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24">
      <div className="w-full max-w-md rounded-xl border border-t-border bg-surface-elevated p-4 shadow-card">
        <h2 className="text-foreground mb-1 text-sm font-semibold">
          Send to Vishtik
        </h2>
        <p className="text-muted mb-3 truncate text-xs">
          Posts to the Vishtik chat for {dealName}
        </p>

        {dryRun && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            Test mode (dry-run): the message is validated and logged but{" "}
            <strong>not actually posted</strong> to Vishtik.
          </div>
        )}

        {sentDryRun ? (
          <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-foreground">
            Dry-run OK — the payload was accepted and logged. Nothing was posted
            to Vishtik.
          </div>
        ) : (
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={5000}
            placeholder="Message to the Vishtik design team…"
            className={`mb-3 w-full resize-none rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 ${a.focusRing}`}
          />
        )}

        {send.isError && (
          <p className="mb-3 text-xs text-red-600 dark:text-red-400">
            {send.error instanceof Error ? send.error.message : "Send failed"}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-muted rounded-lg bg-surface-2 px-3 py-2 text-sm hover:bg-surface"
          >
            {sentDryRun ? "Close" : "Cancel"}
          </button>
          {!sentDryRun && (
            <button
              type="button"
              onClick={() => send.mutate()}
              disabled={send.isPending || !message.trim()}
              className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${a.primaryButton}`}
            >
              {send.isPending
                ? "Sending…"
                : dryRun
                  ? "Send (dry-run)"
                  : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
