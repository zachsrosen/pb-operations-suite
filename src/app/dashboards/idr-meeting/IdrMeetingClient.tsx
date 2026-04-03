"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import { useToast } from "@/contexts/ToastContext";
import { SessionHeader } from "./SessionHeader";
import { ProjectQueue } from "./ProjectQueue";
import { ProjectDetail } from "./ProjectDetail";
import { AddProjectDialog } from "./AddProjectDialog";
import { AddEscalationDialog } from "./AddEscalationDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdrSession {
  id: string;
  date: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED";
  source: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: IdrItem[];
}

export interface IdrItem {
  id: string;
  sessionId: string;
  dealId: string;
  type: "IDR" | "ESCALATION";
  region: string;
  sortOrder: number;
  dealName: string;
  address: string | null;
  projectType: string | null;
  equipmentSummary: string | null;
  systemSizeKw: number | null;
  dealAmount: number | null;
  dealOwner: string | null;
  siteSurveyor: string | null;
  projectManager: string | null;
  operationsManager: string | null;
  surveyStatus: string | null;
  surveyDate: string | null;
  designStatus: string | null;
  plansetDate: string | null;
  driveFolderUrl: string | null;
  surveyFolderUrl: string | null;
  designFolderUrl: string | null;
  ahj: string | null;
  utilityCompany: string | null;
  openSolarUrl: string | null;
  surveyCompleted: boolean;
  snapshotUpdatedAt: string;
  difficulty: number | null;
  installerCount: number | null;
  installerDays: number | null;
  electricianCount: number | null;
  electricianDays: number | null;
  discoReco: boolean | null;
  interiorAccess: boolean | null;
  needsSurveyInfo: boolean | null;
  needsResurvey: boolean | null;
  salesChangeRequested: boolean | null;
  salesChangeNotes: string | null;
  opsChangeNotes: string | null;
  customerNotes: string | null;
  operationsNotes: string | null;
  designNotes: string | null;
  conclusion: string | null;
  escalationReason: string | null;
  reviewed: boolean;
  shitShowFlagged: boolean;
  shitShowReason: string | null;
  hubspotSyncStatus: "DRAFT" | "SYNCED" | "FAILED";
  hubspotSyncedAt: string | null;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
  badge: "green" | "yellow" | "orange" | "red";
  isReturning: boolean;
  notes?: IdrNote[];
}

export interface IdrNote {
  id: string;
  itemId: string;
  dealId: string;
  content: string;
  author: string;
  createdAt: string;
}

interface SessionListItem {
  id: string;
  date: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED";
  createdBy: string;
  _count: { items: number };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PresenceUser {
  email: string;
  name: string | null;
  sessionId: string | null;
  selectedItemId: string | null;
  lastSeen: number;
}

export function IdrMeetingClient({ userEmail }: { userEmail: string }) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEscalationDialog, setShowEscalationDialog] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const isPreview = !sessionId;

  // ── Real-time sync via SSE ──
  // Suppress SSE-driven refetches while the user has pending local edits.
  // Without this, SSE invalidation overwrites optimistic state mid-typing.
  const dirtyRef = useRef(false);
  useSSE(
    () => {
      if (dirtyRef.current) return; // local edits pending — skip refetch
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
      } else {
        queryClient.invalidateQueries({ queryKey: [...queryKeys.idrMeeting.root, "preview"] });
      }
    },
    { cacheKeyFilter: "idr-meeting" },
  );

  // ── Presence heartbeat (every 8s) ──
  const presencePayloadRef = useRef({ sessionId, selectedItemId });
  presencePayloadRef.current = { sessionId, selectedItemId };

  useEffect(() => {
    const sendHeartbeat = () => {
      const { sessionId: sid, selectedItemId: selId } = presencePayloadRef.current;
      fetch("/api/idr-meeting/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, selectedItemId: selId }),
      }).catch(() => {}); // fire-and-forget
    };
    sendHeartbeat(); // immediate
    const interval = setInterval(sendHeartbeat, 8000);
    return () => {
      clearInterval(interval);
      // Signal departure
      fetch("/api/idr-meeting/presence", { method: "DELETE" }).catch(() => {});
    };
  }, []);

  // Send heartbeat on view change (session switch or item selection)
  useEffect(() => {
    fetch("/api/idr-meeting/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, selectedItemId }),
    }).catch(() => {});
  }, [sessionId, selectedItemId]);

  // ── Presence query ──
  const presenceQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "presence", sessionId ?? "preview"],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`/api/idr-meeting/presence${params}`);
      if (!res.ok) return { users: [] as PresenceUser[] };
      return res.json() as Promise<{ users: PresenceUser[] }>;
    },
    refetchInterval: 10000, // poll every 10s as backup to SSE
  });

  const presenceUsers = (presenceQuery.data?.users ?? []).filter(
    (u) => u.email !== userEmail,
  );

  // ── Queries ──
  const sessionsQuery = useQuery({
    queryKey: queryKeys.idrMeeting.sessions(),
    queryFn: async () => {
      const res = await fetch("/api/idr-meeting/sessions?limit=30");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json() as Promise<{ sessions: SessionListItem[]; total: number }>;
    },
  });

  const previewQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "preview"],
    queryFn: async () => {
      const res = await fetch("/api/idr-meeting/preview");
      if (!res.ok) throw new Error("Failed to fetch preview");
      return res.json() as Promise<{ items: IdrItem[] }>;
    },
    enabled: isPreview,
    staleTime: 2 * 60 * 1000,
  });

  const sessionQuery = useQuery({
    queryKey: queryKeys.idrMeeting.session(sessionId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch session");
      return res.json() as Promise<IdrSession>;
    },
    enabled: !!sessionId,
  });

  // ── Mutations ──
  const createSession = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/idr-meeting/sessions", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create session");
      }
      return res.json() as Promise<{ session: { id: string } }>;
    },
    onSuccess: (data) => {
      setSessionId(data.session.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.sessions() });
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(data.session.id) });
      addToast({ type: "success", title: "Session started — prep data carried over" });
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: "Failed to create session", message: err.message });
    },
  });

  const refreshSession = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/idr-meeting/sessions/${id}/refresh`, { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
      }
    },
  });

  // Skip (push to next session) — removes item from current session
  const skipItem = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/idr-meeting/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to skip");
      return res.json();
    },
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
      }
      setSelectedItemId(null);
      addToast({ type: "success", title: "Pushed to next session" });
    },
    onError: () => {
      addToast({ type: "error", title: "Failed to skip item" });
    },
  });

  // ── Auto-init ──
  useEffect(() => {
    if (initialized || !sessionsQuery.data) return;
    setInitialized(true);

    const sessions = sessionsQuery.data.sessions;
    if (sessions.length === 0) return;

    const today = new Date().toISOString().slice(0, 10);
    const todaySession = sessions.find(
      (s) => s.status !== "COMPLETED" && new Date(s.date).toISOString().slice(0, 10) === today,
    );

    if (todaySession) setSessionId(todaySession.id);
  }, [sessionsQuery.data, initialized]);

  useEffect(() => {
    if (!sessionId || !sessionQuery.data) return;
    if (sessionQuery.data.status === "COMPLETED") return;
    refreshSession.mutate(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Debounced save ──
  interface PendingEntry {
    itemId: string;
    dealId: string;
    dealName: string;
    region: string | null;
    updates: Partial<IdrItem>;
  }
  const pendingRef = useRef<Record<string, PendingEntry>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(async () => {
    const pending = { ...pendingRef.current };
    pendingRef.current = {};
    dirtyRef.current = false; // allow SSE refetches again

    for (const [, entry] of Object.entries(pending)) {
      try {
        if (isPreview) {
          const res = await fetch("/api/idr-meeting/prep", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dealId: entry.dealId,
              dealName: entry.dealName,
              region: entry.region,
              ...entry.updates,
            }),
          });
          if (!res.ok) throw new Error("Prep save failed");
        } else {
          const res = await fetch(`/api/idr-meeting/items/${entry.itemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry.updates),
          });
          if (!res.ok) throw new Error("Save failed");
        }
      } catch {
        addToast({ type: "error", title: "Failed to save changes" });
      }
    }

    // Refetch to pick up server-side state after our save completes
    if (sessionId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
    } else {
      queryClient.invalidateQueries({ queryKey: [...queryKeys.idrMeeting.root, "preview"] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isPreview, queryClient, addToast]);

  const handleItemChange = useCallback(
    async (itemId: string, updates: Partial<IdrItem>) => {
      const allItems = isPreview
        ? (previewQuery.data?.items ?? [])
        : (sessionQuery.data?.items ?? []);
      const item = allItems.find((i) => i.id === itemId);
      const dealId = item?.dealId ?? itemId.replace("preview-", "");

      dirtyRef.current = true; // suppress SSE refetch while editing

      const existing = pendingRef.current[itemId];
      pendingRef.current[itemId] = {
        itemId,
        dealId,
        dealName: existing?.dealName ?? item?.dealName ?? "",
        region: existing?.region ?? item?.region ?? null,
        updates: { ...(existing?.updates ?? {}), ...updates },
      };

      // Optimistic update
      if (isPreview) {
        queryClient.setQueryData(
          [...queryKeys.idrMeeting.root, "preview"],
          (old: { items: IdrItem[] } | undefined) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((i) =>
                i.id === itemId ? { ...i, ...updates } : i,
              ),
            };
          },
        );
      } else if (sessionId) {
        queryClient.setQueryData(
          queryKeys.idrMeeting.session(sessionId),
          (old: IdrSession | undefined) => {
            if (!old) return old;
            return {
              ...old,
              items: old.items.map((i) =>
                i.id === itemId ? { ...i, ...updates } : i,
              ),
            };
          },
        );
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flushPending, 400);
    },
    [sessionId, isPreview, queryClient, flushPending, previewQuery.data, sessionQuery.data],
  );

  // ── Resolve display ──
  const displayItems = isPreview
    ? (previewQuery.data?.items ?? [])
    : (sessionQuery.data?.items ?? []);
  const displayLoading = isPreview ? previewQuery.isLoading : sessionQuery.isLoading;

  const selectedItem = displayItems.find((i) => i.id === selectedItemId) ?? null;
  const isArchive = !isPreview && sessionQuery.data?.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-4">
      <SessionHeader
        session={isPreview ? null : (sessionQuery.data ?? null)}
        sessions={sessionsQuery.data?.sessions ?? []}
        onSelectSession={setSessionId}
        onNewSession={() => createSession.mutate()}
        onOpenAddDialog={() => {
          if (isPreview) {
            setShowEscalationDialog(true);
          } else {
            setShowAddDialog(true);
          }
        }}
        onViewPreview={() => setSessionId(null)}
        onSessionEnded={() => {
          setSessionId(null);
          setSelectedItemId(null);
        }}
        creating={createSession.isPending}
        isPreview={isPreview}
        previewCount={previewQuery.data?.items?.length ?? 0}
        presenceUsers={presenceUsers}
      />

      <div className="flex gap-4 h-[calc(100vh-13rem)] overflow-hidden">
        <ProjectQueue
          items={displayItems}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          loading={displayLoading}
          isPreview={isPreview}
          presenceUsers={presenceUsers}
        />

        <ProjectDetail
          item={selectedItem}
          onChange={handleItemChange}
          readOnly={isArchive}
          isPreview={isPreview}
          sessionId={sessionId}
          userEmail={userEmail}
          onSkipItem={
            !isPreview && !isArchive && selectedItem
              ? () => skipItem.mutate(selectedItem.id)
              : undefined
          }
          skipping={skipItem.isPending}
        />
      </div>

      {showAddDialog && sessionId && (
        <AddProjectDialog
          sessionId={sessionId}
          onClose={() => setShowAddDialog(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
            setShowAddDialog(false);
          }}
        />
      )}

      {showEscalationDialog && (
        <AddEscalationDialog onClose={() => setShowEscalationDialog(false)} />
      )}
    </div>
  );
}
