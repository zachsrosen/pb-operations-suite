"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import { SessionHeader } from "./SessionHeader";
import { ProjectQueue } from "./ProjectQueue";
import { ProjectDetail } from "./ProjectDetail";
import { AddProjectDialog } from "./AddProjectDialog";

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
  const [initialized, setInitialized] = useState(false);

  // Fetch session list
  const sessionsQuery = useQuery({
    queryKey: queryKeys.idrMeeting.sessions(),
    queryFn: async () => {
      const res = await fetch("/api/idr-meeting/sessions?limit=30");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json() as Promise<{ sessions: SessionListItem[]; total: number }>;
    },
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
      addToast({ type: "success", title: "New session created" });
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

  // Auto-initialize: load latest or create if none today
  useEffect(() => {
    if (initialized || !sessionsQuery.data) return;
    setInitialized(true);

    const sessions = sessionsQuery.data.sessions;
    if (sessions.length === 0) {
      createSession.mutate();
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const todaySession = sessions.find(
      (s) => new Date(s.date).toISOString().slice(0, 10) === today,
    );

    if (todaySession) {
      setSessionId(todaySession.id);
    } else {
      // Load the latest session
      setSessionId(sessions[0].id);
    }
  }, [sessionsQuery.data, initialized, createSession]);

  // Auto-refresh on session load
  useEffect(() => {
    if (!sessionId || !sessionQuery.data) return;
    if (sessionQuery.data.status === "COMPLETED") return;
    refreshSession.mutate(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Update item locally + on server
  const handleItemChange = useCallback(
    async (itemId: string, updates: Partial<IdrItem>) => {
      try {
        const res = await fetch(`/api/idr-meeting/items/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Save failed");
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.session(sessionId) });
        }
      } catch {
        addToast({ type: "error", title: "Failed to save changes" });
      }
    },
    [sessionId, queryClient, addToast],
  );

  const selectedItem = sessionQuery.data?.items?.find((i) => i.id === selectedItemId) ?? null;
  const isArchive = sessionQuery.data?.status === "COMPLETED";

  return (
    <div className="flex flex-col gap-4">
      <SessionHeader
        session={sessionQuery.data ?? null}
        sessions={sessionsQuery.data?.sessions ?? []}
        onSelectSession={setSessionId}
        onNewSession={() => createSession.mutate()}
        onOpenAddDialog={() => setShowAddDialog(true)}
        creating={createSession.isPending}
      />

      <div className="flex gap-4 h-[calc(100vh-16rem)] overflow-hidden">
        <ProjectQueue
          items={sessionQuery.data?.items ?? []}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          loading={sessionQuery.isLoading}
        />

        <ProjectDetail
          item={selectedItem}
          onChange={handleItemChange}
          readOnly={isArchive}
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
    </div>
  );
}
