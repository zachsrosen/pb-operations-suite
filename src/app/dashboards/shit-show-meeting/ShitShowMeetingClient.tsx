"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShitShowSession, ShitShowItem, PresenceUser } from "./types";
import { SessionHeader } from "./SessionHeader";
import { ProjectQueue } from "./ProjectQueue";
import { ProjectDetail } from "./ProjectDetail";
import { AddProjectDialog } from "./AddProjectDialog";

const PRESENCE_INTERVAL_MS = 10_000;
const SESSION_REFRESH_MS = 5_000;
const FLAGGED_REFRESH_MS = 15_000;

export function ShitShowMeetingClient({ userEmail }: { userEmail: string }) {
  const [sessions, setSessions] = useState<ShitShowSession[]>([]);
  const [activeSession, setActiveSession] = useState<ShitShowSession | null>(null);
  // Live HubSpot-flagged deals when no active session — same shape as session items.
  const [flaggedItems, setFlaggedItems] = useState<ShitShowItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [priorCounts, setPriorCounts] = useState<Map<string, number>>(new Map());

  // ---------- Data loading ----------

  const loadFlaggedDeals = useCallback(async () => {
    const res = await fetch("/api/shit-show-meeting/flagged-deals");
    if (res.ok) {
      const json = (await res.json()) as { items: ShitShowItem[] };
      setFlaggedItems(json.items);
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const res = await fetch(`/api/shit-show-meeting/sessions/${id}`);
    if (res.ok) {
      const json = (await res.json()) as { session: ShitShowSession };
      setActiveSession(json.session);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/shit-show-meeting/sessions");
    if (res.ok) {
      const json = (await res.json()) as { sessions: ShitShowSession[] };
      setSessions(json.sessions);
      // Pick the most recent ACTIVE or DRAFT session if any. COMPLETED sessions
      // don't auto-select — when the latest session is COMPLETED, fall through
      // to the live flagged-deals view.
      const active = json.sessions.find((s) => s.status === "ACTIVE");
      const draft = json.sessions.find((s) => s.status === "DRAFT");
      const pickId = active?.id ?? draft?.id ?? null;
      if (pickId) {
        await loadSession(pickId);
      } else {
        setActiveSession(null);
      }
    }
  }, [loadSession]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSessions();
    void loadFlaggedDeals();
  }, [loadSessions, loadFlaggedDeals]);

  // Refresh active session every 5s for cross-client updates
  useEffect(() => {
    if (!activeSession) return;
    const t = setInterval(() => {
      void loadSession(activeSession.id);
    }, SESSION_REFRESH_MS);
    return () => clearInterval(t);
  }, [activeSession, loadSession]);

  // Refresh the live flagged-deals view periodically when no active session
  useEffect(() => {
    if (activeSession) return;
    const t = setInterval(() => {
      void loadFlaggedDeals();
    }, FLAGGED_REFRESH_MS);
    return () => clearInterval(t);
  }, [activeSession, loadFlaggedDeals]);

  // ---------- Presence heartbeat (only when in an active session) ----------

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;

    const beat = async () => {
      await fetch("/api/shit-show-meeting/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession.id,
          selectedItemId,
        }),
      });
      const res = await fetch(
        `/api/shit-show-meeting/presence?sessionId=${activeSession.id}`,
      );
      if (res.ok && !cancelled) {
        const json = (await res.json()) as { users: PresenceUser[] };
        setPresence(json.users);
      }
    };

    void beat();
    const t = setInterval(beat, PRESENCE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
      void fetch("/api/shit-show-meeting/presence", { method: "DELETE" });
    };
  }, [activeSession, selectedItemId]);

  // ---------- Prior-session counts (history badges) ----------

  const loadPriorCounts = useCallback(async (items: ShitShowItem[]) => {
    if (items.length === 0) return;
    const counts = new Map<string, number>();
    await Promise.all(
      items.map(async (item) => {
        const res = await fetch(
          `/api/shit-show-meeting/search?q=${encodeURIComponent(item.dealName)}`,
        );
        if (!res.ok) return;
        type SearchItem = { id: string; dealId: string };
        const json = (await res.json()) as { items: SearchItem[] };
        const priors = json.items.filter(
          (i) => i.dealId === item.dealId && i.id !== item.id,
        ).length;
        counts.set(item.dealId, priors);
      }),
    );
    setPriorCounts(counts);
  }, []);

  // ---------- Session actions ----------

  async function handleCreate() {
    const res = await fetch("/api/shit-show-meeting/sessions", { method: "POST" });
    if (res.ok) {
      const json = (await res.json()) as { session: ShitShowSession };
      // Immediately snapshot so the queue populates with currently-flagged deals
      await fetch(`/api/shit-show-meeting/sessions/${json.session.id}/snapshot`, {
        method: "POST",
      });
      await loadSession(json.session.id);
      await loadSessions();
    } else {
      const err = await res.json().catch(() => ({}));
      if ((err as { error?: string }).error === "active_session_exists") {
        alert("An active session already exists.");
      }
    }
  }

  async function handleStart() {
    if (!activeSession) return;
    await fetch(`/api/shit-show-meeting/sessions/${activeSession.id}/snapshot`, {
      method: "POST",
    });
    await loadSession(activeSession.id);
  }

  async function handleEnd() {
    if (!activeSession) return;
    if (!confirm("End the meeting? This posts HubSpot notes for each item.")) return;
    await fetch(`/api/shit-show-meeting/sessions/${activeSession.id}/end`, {
      method: "POST",
    });
    await loadSessions(); // re-pick: COMPLETED won't auto-select, so we fall back to flagged-deals view
    await loadFlaggedDeals();
  }

  async function handleRefresh() {
    if (activeSession) {
      await fetch(`/api/shit-show-meeting/sessions/${activeSession.id}/snapshot`, {
        method: "POST",
      });
      await loadSession(activeSession.id);
    } else {
      await loadFlaggedDeals();
    }
  }

  // ---------- Derived state ----------

  // When in an active session, items come from the session (so meeting work
  // attaches to them). Otherwise, items come from the live flagged-deals view.
  const items = activeSession?.items ?? flaggedItems;
  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );
  // The detail pane shows meeting controls (decisions, notes, assignments) only
  // when we're in an ACTIVE session AND looking at a real (non-preview) item.
  const meetingMode =
    activeSession?.status === "ACTIVE" && !!selectedItemId && !selectedItemId.startsWith("preview-");

  useEffect(() => {
    if (!selectedItemId && items.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedItemId(items[0].id);
    }
  }, [items, selectedItemId]);

  // Reload prior-counts when items change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPriorCounts(items);
  }, [items, loadPriorCounts]);

  void sessions;
  void userEmail;

  // ---------- Render ----------

  const emptyMessage = activeSession
    ? "Pick a deal from the queue."
    : items.length === 0
      ? "No deals are flagged 🔥 in HubSpot. Use '+ Add a deal' to flag one, or toggle the 🔥 flag on a deal in the IDR Meeting hub."
      : "Pick a deal from the queue.";

  return (
    <div className="flex flex-col h-[calc(100vh-180px)]">
      <SessionHeader
        session={activeSession}
        presence={presence}
        onStart={handleStart}
        onEnd={handleEnd}
        onCreate={handleCreate}
      />
      <div className="flex-1 grid grid-cols-[320px_1fr] overflow-hidden">
        <div className="border-r border-t-border flex flex-col">
          {/* Always-on queue actions — independent of session state. */}
          <div className="p-2 border-b border-t-border space-y-2">
            <button
              onClick={() => setShowAddDialog(true)}
              className="w-full bg-red-600 hover:bg-red-500 text-white text-sm px-3 py-1.5 rounded"
            >
              + Add a deal
            </button>
            <button
              onClick={handleRefresh}
              className="w-full bg-surface-2 hover:bg-surface-elevated border border-t-border text-foreground text-xs px-3 py-1 rounded"
              title="Re-pull currently-flagged deals from HubSpot"
            >
              ↻ Refresh from HubSpot
            </button>
          </div>
          <ProjectQueue
            items={items}
            selectedId={selectedItemId}
            onSelect={setSelectedItemId}
            priorCounts={priorCounts}
          />
        </div>
        <div className="overflow-hidden">
          {selectedItem ? (
            <ProjectDetail
              item={selectedItem}
              readOnly={!meetingMode}
              onChanged={async () => {
                if (activeSession) await loadSession(activeSession.id);
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted text-sm px-8 text-center">
              {emptyMessage}
            </div>
          )}
        </div>
      </div>

      <AddProjectDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdded={async () => {
          if (activeSession) {
            await fetch(`/api/shit-show-meeting/sessions/${activeSession.id}/snapshot`, {
              method: "POST",
            });
            await loadSession(activeSession.id);
          } else {
            await loadFlaggedDeals();
          }
        }}
      />
    </div>
  );
}
