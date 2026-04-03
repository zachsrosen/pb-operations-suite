"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import { SessionHeader } from "./SessionHeader";
import { ProjectQueue } from "./ProjectQueue";
import { ProjectDetail } from "./ProjectDetail";
import { AddProjectDialog } from "./AddProjectDialog";
import { EscalationQueue } from "./EscalationQueue";
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

export function IdrMeetingClient({ userEmail }: { userEmail: string }) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEscalationDialog, setShowEscalationDialog] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Is the user viewing the live preview (no session selected)?
  const isPreview = !sessionId;

  // Fetch session list
  const sessionsQuery = useQuery({
    queryKey: queryKeys.idrMeeting.sessions(),
    queryFn: async () => {
      const res = await fetch("/api/idr-meeting/sessions?limit=30");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json() as Promise<{ sessions: SessionListItem[]; total: number }>;
    },
  });

  // Fetch live preview (no session required)
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

  // Fetch current session detail
  const sessionQuery = useQuery({
    queryKey: queryKeys.idrMeeting.session(sessionId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Failed to fetch session");
      return res.json() as Promise<IdrSession>;
    },
    enabled: !!sessionId,
  });

  // Create session mutation
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
      addToast({ type: "success", title: "Session started" });
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: "Failed to create session", message: err.message });
    },
  });

  // Background refresh mutation
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

  // Auto-initialize: if there's a session for today, load it. Otherwise stay in preview.
  useEffect(() => {
    if (initialized || !sessionsQuery.data) return;
    setInitialized(true);

    const sessions = sessionsQuery.data.sessions;
    if (sessions.length === 0) return; // Stay in preview

    const today = new Date().toISOString().slice(0, 10);
    const todaySession = sessions.find(
      (s) => s.status !== "COMPLETED" && new Date(s.date).toISOString().slice(0, 10) === today,
    );

    if (todaySession) {
      setSessionId(todaySession.id);
    }
    // Otherwise stay in preview — don't auto-load old sessions
  }, [sessionsQuery.data, initialized]);

  // Auto-refresh on session load
  useEffect(() => {
    if (!sessionId || !sessionQuery.data) return;
    if (sessionQuery.data.status === "COMPLETED") return;
    refreshSession.mutate(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Debounced save — queues field updates and flushes after 600ms of inactivity
  const pendingRef = useRef<Record<string, { itemId: string; updates: Partial<IdrItem> }>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(async () => {
    const pending = { ...pendingRef.current };
    pendingRef.current = {};

    for (const [itemId, entry] of Object.entries(pending)) {
      try {
        const res = await fetch(`/api/idr-meeting/items/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry.updates),
        });
        if (!res.ok) throw new Error("Save failed");
      } catch {
        addToast({ type: "error", title: "Failed to save changes" });
      }
    }
    if (sessionId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
    }
  }, [sessionId, queryClient, addToast]);

  const handleItemChange = useCallback(
    async (itemId: string, updates: Partial<IdrItem>) => {
      // Merge into pending updates for this item
      const existing = pendingRef.current[itemId];
      pendingRef.current[itemId] = {
        itemId,
        updates: { ...(existing?.updates ?? {}), ...updates },
      };

      // Optimistically update the local query cache
      if (sessionId) {
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

      // Debounce the server call
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flushPending, 600);
    },
    [sessionId, queryClient, flushPending],
  );

  // Resolve which items to display
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
        onOpenAddDialog={() => setShowAddDialog(true)}
        onViewPreview={() => setSessionId(null)}
        onSessionEnded={() => {
          setSessionId(null);
          setSelectedItemId(null);
        }}
        creating={createSession.isPending}
        isPreview={isPreview}
        previewCount={previewQuery.data?.items?.length ?? 0}
      />

      {/* Escalation queue — always visible for meeting prep */}
      <EscalationQueue onAddEscalation={() => setShowEscalationDialog(true)} />

      <div className="flex gap-4 h-[calc(100vh-16rem)] overflow-hidden">
        <ProjectQueue
          items={displayItems}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          loading={displayLoading}
        />

        <ProjectDetail
          item={selectedItem}
          onChange={handleItemChange}
          readOnly={isPreview || isArchive}
          sessionId={sessionId}
          userEmail={userEmail}
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
