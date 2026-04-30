"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getInternalDealUrl } from "@/lib/external-links";
import type { IdrNote } from "./IdrMeetingClient";

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || "7086286";

interface SessionItem {
  id: string;
  type: "IDR" | "ESCALATION";
  dealId: string;
  dealName: string;
  address: string | null;
  region: string | null;
  projectType: string | null;
  systemSizeKw: number | null;
  dealAmount: number | null;
  dealOwner: string | null;
  designStatus: string | null;
  equipmentSummary: string | null;
  difficulty: number | null;
  installerCount: number | null;
  installerDays: number | null;
  electricianCount: number | null;
  electricianDays: number | null;
  discoReco: boolean | null;
  interiorAccess: boolean | null;
  needsSurveyInfo: boolean | null;
  salesChangeRequested: boolean | null;
  salesChangeNotes: string | null;
  opsChangeNotes: string | null;
  customerNotes: string | null;
  operationsNotes: string | null;
  opsRevisionNotes: string | null;
  designNotes: string | null;
  conclusion: string | null;
  escalationReason: string | null;
  shitShowFlagged: boolean;
  shitShowReason: string | null;
  adderTileRoof: boolean;
  adderMetalRoof: boolean;
  adderFlatFoamRoof: boolean;
  adderShakeRoof: boolean;
  adderSteepPitch: boolean;
  adderTwoStorey: boolean;
  adderTrenching: boolean;
  adderGroundMount: boolean;
  adderMpuUpgrade: boolean;
  adderEvCharger: boolean;
  adderTier1: boolean;
  adderTier2: boolean;
  customAdders: unknown;
  session: { date: string; status: string };
  createdAt: string;
}

interface DealHistoryResponse {
  items: SessionItem[];
  notes: IdrNote[];
}

interface Props {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
}

type TimelineEntry =
  | { type: "meeting"; date: string; data: SessionItem }
  | { type: "note"; date: string; data: IdrNote };

export function DealHistoryDetail({ dealId, dealName, region, systemSizeKw, projectType }: Props) {
  const historyQuery = useQuery({
    queryKey: queryKeys.idrMeeting.dealHistory(dealId),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/deal-history/${dealId}`);
      if (!res.ok) throw new Error("Failed to fetch deal history");
      return res.json() as Promise<DealHistoryResponse>;
    },
    staleTime: 60 * 1000,
  });

  // Merge items and notes into chronological timeline (newest first)
  const entries: TimelineEntry[] = [];
  if (historyQuery.data) {
    for (const item of historyQuery.data.items) {
      entries.push({ type: "meeting", date: item.session.date, data: item });
    }
    for (const note of historyQuery.data.notes) {
      entries.push({ type: "note", date: note.createdAt, data: note });
    }
  }
  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const address = historyQuery.data?.items[0]?.address;

  return (
    <div className="flex-1 rounded-xl border border-t-border bg-surface overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Deal header */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{dealName}</h2>
            <Link
              href={getInternalDealUrl(dealId)}
              className="inline-flex items-center gap-0.5 rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-300 hover:bg-purple-500/20 transition-colors no-underline"
            >
              Deal
            </Link>
            <a
              href={`https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${dealId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded border border-t-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-surface transition-colors"
            >
              HubSpot <span className="text-muted">&#8599;</span>
            </a>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted">
            {address && <span>{address}</span>}
            {region && <span>{region}</span>}
            {systemSizeKw && <span>{systemSizeKw} kW</span>}
            {projectType && <span>{projectType}</span>}
          </div>
        </div>

        {/* Loading */}
        {historyQuery.isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-surface-2 animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty */}
        {entries.length === 0 && !historyQuery.isLoading && (
          <p className="text-sm text-muted">No meeting history for this deal.</p>
        )}

        {/* Timeline */}
        {entries.map((entry) =>
          entry.type === "meeting" ? (
            <SessionCard key={`m-${entry.data.id}`} item={entry.data as SessionItem} />
          ) : (
            <StandaloneNoteCard key={`n-${(entry.data as IdrNote).id}`} note={entry.data as IdrNote} />
          ),
        )}
      </div>
    </div>
  );
}

/* ── Session Card ── */

function SessionCard({ item }: { item: SessionItem }) {
  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50 p-3 space-y-2">
      {/* Date + type badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-orange-500">
          {new Date(item.session.date).toLocaleDateString()}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            item.type === "ESCALATION"
              ? "bg-orange-500/15 text-orange-500"
              : "bg-surface text-muted"
          }`}
        >
          {item.type}
        </span>
      </div>

      {/* Snapshot context grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <SnapCell label="Design Status" value={item.designStatus} />
        <SnapCell label="Deal Owner" value={item.dealOwner} />
        <SnapCell label="System Size" value={item.systemSizeKw ? `${item.systemSizeKw} kW` : null} />
        <SnapCell label="Equipment" value={item.equipmentSummary} />
        <SnapCell label="Difficulty" value={item.difficulty != null ? `${item.difficulty}/5` : null} />
        <SnapCell label="Deal Amount" value={item.dealAmount ? `$${item.dealAmount.toLocaleString()}` : null} />
      </div>

      {/* Install planning row */}
      {(item.installerCount != null || item.electricianCount != null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
          {(item.installerCount != null || item.installerDays != null) && (
            <span>Roofers: {item.installerCount ?? "?"} × {item.installerDays ?? "?"} day{(item.installerDays ?? 0) !== 1 ? "s" : ""}</span>
          )}
          {(item.electricianCount != null || item.electricianDays != null) && (
            <span>Electricians: {item.electricianCount ?? "?"} × {item.electricianDays ?? "?"} day{(item.electricianDays ?? 0) !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      {/* Status flags */}
      <div className="flex flex-wrap gap-1.5">
        <FlagChip label="Disco/Reco" active={item.discoReco} />
        <FlagChip label="Interior Access" active={item.interiorAccess} />
        {item.needsSurveyInfo && <FlagChip label="Needs Survey Info" active={true} color="yellow" />}
        {item.salesChangeRequested && <FlagChip label="Sales Change" active={true} color="yellow" />}
        {item.shitShowFlagged && <FlagChip label="🔥 Shit Show" active={true} color="red" />}
      </div>

      {/* Adders */}
      {(() => {
        const adders: string[] = [];
        if (item.adderTileRoof) adders.push("Tile roof");
        if (item.adderMetalRoof) adders.push("Metal roof");
        if (item.adderFlatFoamRoof) adders.push("Flat/foam");
        if (item.adderShakeRoof) adders.push("Shake");
        if (item.adderSteepPitch) adders.push("Steep pitch");
        if (item.adderTwoStorey) adders.push("2+ storey");
        if (item.adderTrenching) adders.push("Trenching");
        if (item.adderGroundMount) adders.push("Ground mount");
        if (item.adderMpuUpgrade) adders.push("MPU upgrade");
        if (item.adderEvCharger) adders.push("EV charger");
        if (item.adderTier1) adders.push(`Tier 1 (15%)${item.dealAmount ? ` $${Math.round(item.dealAmount * 0.15).toLocaleString()}` : ""}`);
        if (item.adderTier2) adders.push(`Tier 2 (20%)${item.dealAmount ? ` $${Math.round(item.dealAmount * 0.20).toLocaleString()}` : ""}`);
        const customs = Array.isArray(item.customAdders) ? item.customAdders as Array<{ name: string; amount: number }> : [];
        for (const c of customs) {
          if (c && typeof c === "object" && "name" in c) {
            adders.push(`${c.name} ($${Math.abs(c.amount).toLocaleString()})`);
          }
        }
        if (adders.length === 0) return null;
        return (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">Adders</p>
            <p className="text-xs text-foreground">{adders.join(", ")}</p>
          </div>
        );
      })()}

      {/* Notes */}
      <div className="border-t border-t-border pt-2 space-y-1.5">
        {item.escalationReason && (
          <NoteField label="Escalation Reason" value={item.escalationReason} color="text-orange-500" />
        )}
        {item.shitShowReason && (
          <NoteField label="Shit Show Reason" value={item.shitShowReason} color="text-red-400" />
        )}
        {item.conclusion && (
          <NoteField label="Conclusion" value={item.conclusion} color="text-emerald-500" />
        )}
        {item.customerNotes && (
          <NoteField label="Customer Notes" value={item.customerNotes} />
        )}
        {item.operationsNotes && (
          <NoteField label="Ops Notes" value={item.operationsNotes} />
        )}
        {item.opsRevisionNotes && (
          <NoteField label="Ops Revision Notes" value={item.opsRevisionNotes} />
        )}
        {item.designNotes && (
          <NoteField label="Design Notes" value={item.designNotes} />
        )}
        {item.salesChangeNotes && (
          <NoteField label="Sales Change Reason" value={item.salesChangeNotes} />
        )}
        {item.opsChangeNotes && (
          <NoteField label="Ops Change Reason" value={item.opsChangeNotes} />
        )}
        {!item.conclusion && !item.customerNotes && !item.operationsNotes && !item.opsRevisionNotes && !item.designNotes && !item.escalationReason && (
          <p className="text-xs text-muted italic">No notes recorded</p>
        )}
      </div>
    </div>
  );
}

function SnapCell({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[9px] text-muted uppercase tracking-wider">{label}</p>
      <p className="text-xs text-foreground truncate">{value}</p>
    </div>
  );
}

function FlagChip({ label, active, color }: { label: string; active: boolean | null | undefined; color?: "yellow" | "red" }) {
  if (active == null) return null;
  const bg = color === "red"
    ? "bg-red-500/15 text-red-400"
    : color === "yellow"
      ? "bg-yellow-500/15 text-yellow-400"
      : active
        ? "bg-emerald-500/15 text-emerald-400"
        : "bg-surface text-muted";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${bg}`}>
      {label}: {active ? "Yes" : "No"}
    </span>
  );
}

function NoteField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className={`text-[9px] font-semibold uppercase tracking-wider ${color ?? "text-muted"}`}>{label}</p>
      <p className="text-xs text-foreground whitespace-pre-wrap">{value}</p>
    </div>
  );
}

/* ── Standalone Note Card ── */

function StandaloneNoteCard({ note }: { note: IdrNote }) {
  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50 p-3 border-l-[3px] border-l-purple-500">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-purple-500">
          {new Date(note.createdAt).toLocaleDateString()}
        </span>
        <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-500">
          Note
        </span>
        <span className="text-[11px] text-muted">{note.author}</span>
      </div>
      <p className="text-xs text-foreground whitespace-pre-wrap">{note.content}</p>
    </div>
  );
}
