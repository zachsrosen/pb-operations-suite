"use client";

import { useState } from "react";
import type { ShitShowSession, PresenceUser } from "./types";

export function SessionHeader({
  session,
  presence,
  onStart,
  onEnd,
  onCreate,
}: {
  session: ShitShowSession | null;
  presence: PresenceUser[];
  onStart: () => Promise<void>;
  onEnd: () => Promise<void>;
  onCreate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between bg-surface border-b border-t-border px-4 py-3">
      <div className="flex items-center gap-3">
        {session ? (
          <>
            <span className="text-sm text-foreground font-medium">
              {new Date(session.date).toLocaleDateString()}
            </span>
            <StatusPill status={session.status} />
            <span className="text-xs text-muted">created by {session.createdBy}</span>
          </>
        ) : (
          <span className="text-sm text-muted">No active session</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <PresenceChips users={presence} />
        {session?.status === "DRAFT" && (
          <button
            onClick={() => wrap(onStart)}
            disabled={busy}
            className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            🔥 Start meeting
          </button>
        )}
        {session?.status === "ACTIVE" && (
          <button
            onClick={() => wrap(onEnd)}
            disabled={busy}
            className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            End meeting
          </button>
        )}
        {(!session || session.status === "COMPLETED") && (
          <button
            onClick={() => wrap(onCreate)}
            disabled={busy}
            className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            + New session
          </button>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ShitShowSession["status"] }) {
  const styles = {
    DRAFT: "bg-zinc-700 text-zinc-100",
    ACTIVE: "bg-red-700 text-red-50",
    COMPLETED: "bg-emerald-700 text-emerald-50",
  } as const;
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${styles[status]}`}>
      {status}
    </span>
  );
}

function PresenceChips({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mr-2">
      {users.slice(0, 5).map((u) => (
        <div
          key={u.email}
          title={u.name ?? u.email}
          className="w-7 h-7 rounded-full bg-orange-700 text-white text-[11px] flex items-center justify-center"
        >
          {(u.name ?? u.email).slice(0, 2).toUpperCase()}
        </div>
      ))}
      {users.length > 5 && (
        <span className="text-xs text-muted">+{users.length - 5}</span>
      )}
    </div>
  );
}
