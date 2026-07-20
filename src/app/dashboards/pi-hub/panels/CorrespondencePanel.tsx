"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ProjectDetail, Team } from "@/lib/pi-hub/types";
import type { SharedInboxThreadMessage } from "@/lib/gmail-shared-inbox";

interface Props {
  team: Team;
  searchUrl: string | null;
  threads: ProjectDetail["correspondenceThreads"];
  inbox: string | null;
  identifiers: string[];
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameYear = d.getFullYear() === today.getFullYear();
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Application-identifier shapes a message can cite: Xcel IA numbers and
 *  8-digit case numbers. Leading zeros are stripped for comparison — legacy
 *  deals store case numbers un-padded. */
function citedIdentifiers(text: string): string[] {
  return [...text.matchAll(/\b(IA\d{5,}|0\d{7})\b/gi)].map((m) =>
    m[1].toUpperCase().replace(/^0+(?=\d)/, ""),
  );
}

/** True when the message cites application identifiers and NONE of them are
 *  this project's — i.e. Gmail threaded another project's notification into
 *  the same conversation (Xcel chatter emails all share one subject line). */
function isForeignMessage(
  m: SharedInboxThreadMessage,
  ownIdentifiers: Set<string>,
): boolean {
  if (ownIdentifiers.size === 0) return false;
  const cited = citedIdentifiers(`${m.subject ?? ""}\n${m.bodyText}`);
  return cited.length > 0 && !cited.some((c) => ownIdentifiers.has(c));
}

/** Expanded thread body — fetched on first open, rendered in-app so
 *  delegated users never need a Gmail sign-in. */
function ThreadMessages({
  team,
  threadId,
  inbox,
  identifiers,
}: {
  team: Team;
  threadId: string;
  inbox: string;
  identifiers: string[];
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const ownIdentifiers = new Set(
    identifiers.map((t) => t.toUpperCase().replace(/^0+(?=\d)/, "")),
  );
  const query = useQuery<{ messages: SharedInboxThreadMessage[] }>({
    queryKey: queryKeys.piHub.thread(team, threadId),
    queryFn: async () => {
      const r = await fetch(
        `/api/pi-hub/thread/${encodeURIComponent(threadId)}?team=${team}&inbox=${encodeURIComponent(inbox)}`,
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (query.isPending) {
    return (
      <div className="text-muted border-t-border mt-3 border-t pt-3 text-xs">
        Loading email…
      </div>
    );
  }
  if (query.isError || !query.data?.messages?.length) {
    return (
      <div className="text-muted border-t-border mt-3 border-t pt-3 text-xs">
        Couldn&apos;t load this email — try the Gmail link instead.
      </div>
    );
  }

  return (
    <div className="border-t-border mt-3 space-y-3 border-t pt-3">
      {query.data.messages.map((m) => {
        if (isForeignMessage(m, ownIdentifiers) && !revealed.has(m.id)) {
          const cited = citedIdentifiers(`${m.subject ?? ""}\n${m.bodyText}`);
          return (
            <div key={m.id} className="text-muted flex items-center gap-2 text-xs">
              <span>
                Message about a different project ({cited[0] ?? "other id"}) —
                Gmail threads Xcel notifications together
              </span>
              <button
                type="button"
                onClick={() =>
                  setRevealed((prev) => new Set(prev).add(m.id))
                }
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                show
              </button>
            </div>
          );
        }
        return (
          <div key={m.id} className="text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{m.from ?? "—"}</span>
              <span className="text-muted shrink-0">{formatDateTime(m.date)}</span>
            </div>
            {m.to && <div className="text-muted">to {m.to}</div>}
            <pre className="text-foreground/90 mt-1.5 max-h-96 overflow-y-auto font-sans whitespace-pre-wrap break-words">
              {m.bodyText || "(no readable body)"}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

export function CorrespondencePanel({ team, searchUrl, threads, inbox, identifiers }: Props) {
  const hasThreads = threads && threads.length > 0;
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="text-muted flex items-center justify-between text-xs">
        <span>
          {inbox ? (
            <>
              Showing last {threads.length} thread{threads.length === 1 ? "" : "s"}{" "}
              from <span className="font-medium">{inbox}</span>
            </>
          ) : (
            "Shared inbox not configured for this region — showing Gmail search link only."
          )}
        </span>
        {searchUrl && (
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Open Gmail search →
          </a>
        )}
      </div>

      {hasThreads ? (
        <ul className="space-y-2">
          {threads.map((t) => {
            const open = openThreadId === t.id;
            return (
              <li
                key={t.id}
                className="rounded-lg border border-t-border p-3 transition-colors hover:bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() => setOpenThreadId(open ? null : t.id)}
                  className="block w-full text-left"
                  aria-expanded={open}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {t.subject ?? "(no subject)"}
                      </div>
                      <div className="text-muted truncate text-xs">
                        {t.from ?? t.fromEmail ?? "—"}
                      </div>
                    </div>
                    <div className="text-muted flex shrink-0 items-center gap-2 text-xs">
                      <span>{formatDate(t.date)}</span>
                      <span aria-hidden>{open ? "▾" : "▸"}</span>
                    </div>
                  </div>
                  {!open && t.snippet && (
                    <div className="text-muted mt-1 line-clamp-2 text-xs">
                      {t.snippet}
                    </div>
                  )}
                </button>
                {open && inbox && (
                  <>
                    <ThreadMessages
                      team={team}
                      threadId={t.id}
                      inbox={inbox}
                      identifiers={identifiers}
                    />
                    <div className="mt-2 text-right">
                      <a
                        href={t.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted text-xs hover:underline"
                        title="Requires the shared mailbox to be signed in to your browser"
                      >
                        Open in Gmail ↗
                      </a>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : inbox ? (
        <div className="text-muted text-sm">
          No matching threads in the last 90 days.
        </div>
      ) : null}
    </div>
  );
}
