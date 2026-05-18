"use client";

import { useState, useCallback, use } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { queryKeys } from "@/lib/query-keys";
import { PeAuditProgress } from "@/components/pe-prep/PeAuditProgress";
import { PeChecklistCard } from "@/components/pe-prep/PeChecklistCard";
import { PePhotoGrid } from "@/components/pe-prep/PePhotoGrid";
import { PePhotoModal } from "@/components/pe-prep/PePhotoModal";
import { PePandaDocSection } from "@/components/pe-prep/PePandaDocSection";
import PhotoGalleryCard from "@/components/deal-detail/PhotoGalleryCard";

interface DealLinks {
  hubspotUrl: string;
  pePortalUrl: string | null;
  driveFolderUrl: string | null;
  dealName: string | null;
}

interface PandaDocStatus {
  key: string;
  templateId: string | null;
  document: {
    id: string;
    name: string;
    status: string;
    dateCompleted: string | null;
  } | null;
}

interface AuditRunData {
  links?: DealLinks;
  pandadocStatuses?: PandaDocStatus[];
  auditRun: {
    id: string;
    dealId: string;
    dealName: string;
    milestone: string;
    systemType: string;
    status: string;
    results: Array<{
      name: string;
      label: string;
      items: Array<{
        item: { id: string; label: string; category: string; isPhoto: boolean; pePhotoNumber?: number };
        status: string;
        statusNote?: string;
        foundFile?: { name: string; id: string; url: string; thumbnailUrl?: string; source?: "drive" | "zuper" | "pandadoc"; modifiedTime: string; size: number };
        combinedFile?: boolean;
        visionResult?: {
          status: "pass" | "fail" | "needs_review";
          notes: string;
          confidence: "high" | "medium" | "low";
          issues: string[];
          signatures?: { present: boolean; count: number; allSigned: boolean };
          equipmentVisible?: string[];
          pmOverride?: { overriddenAt: string; originalVerdict: string };
        };
      }>;
    }>;
    summary: {
      totalItems: number;
      found: number;
      missing: number;
      needsReview: number;
      notApplicable: number;
      errors: number;
      ready: boolean;
    };
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    packageFolderUrl?: string;
  } | null;
}

export default function PePrepPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = use(params);
  const queryClient = useQueryClient();
  const [selectedPhoto, setSelectedPhoto] = useState<Parameters<typeof PePhotoModal>[0]["photo"]>(null);
  const [assembling, setAssembling] = useState(false);
  const [milestone, setMilestone] = useState<"m1" | "m2">("m1");

  const { data, isLoading } = useQuery<AuditRunData>({
    queryKey: queryKeys.pePrep.status(dealId),
    queryFn: async () => {
      const res = await fetch(`/api/pe-prep/${dealId}/status`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const auditRun = data?.auditRun;
  const links = data?.links;
  const pandadocStatuses = data?.pandadocStatuses;
  const hasResults = auditRun?.status === "completed" && auditRun.results;

  const handleAuditComplete = useCallback((_auditRunId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.pePrep.status(dealId) });
  }, [dealId, queryClient]);

  const handleAssemble = async () => {
    if (!auditRun?.id) return;
    setAssembling(true);
    try {
      const res = await fetch(`/api/pe-prep/${dealId}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditRunId: auditRun.id }),
      });
      if (res.ok) {
        const result = await res.json();
        if (result.folderUrl) window.open(result.folderUrl, "_blank");
        queryClient.invalidateQueries({ queryKey: queryKeys.pePrep.status(dealId) });
      }
    } finally {
      setAssembling(false);
    }
  };

  const photoResults = hasResults
    ? auditRun.results.flatMap((cat) => cat.items).filter((r) => r.item.isPhoto)
    : [];

  const docCategories = hasResults
    ? auditRun.results.filter((cat) => cat.items.some((r) => !r.item.isPhoto))
    : [];

  const s = auditRun?.summary;
  const lastAuditLabel = auditRun?.completedAt
    ? `Last audited ${new Date(auditRun.completedAt).toLocaleString()}`
    : auditRun?.status === "running" ? "Audit in progress..." : undefined;

  const displayName = auditRun?.dealName || links?.dealName;

  return (
    <DashboardShell
      title={displayName ? `PE Prep: ${displayName}` : "PE File Preparation"}
      accentColor="orange"
      lastUpdated={lastAuditLabel}
      fullWidth
    >
      <div className="space-y-6">
        {links && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={links.hubspotUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.16 5.67c-.52-.4-1.18-.62-1.88-.56-.7.06-1.34.4-1.78.94l-4.14 5.08-3.28-2.6c-.44-.34-1-.52-1.58-.52-1.38 0-2.5 1.12-2.5 2.5 0 .58.18 1.14.54 1.58l4.5 5.5c.44.54 1.1.86 1.8.86h.14c.76-.06 1.44-.46 1.84-1.1l6.08-9.5c.62-.98.34-2.28-.64-2.9l-.1-.08z"/></svg>
              HubSpot Deal
            </a>
            {links.pePortalUrl && (
              <a
                href={links.pePortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                PE Portal
              </a>
            )}
            {links.driveFolderUrl && (
              <a
                href={links.driveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                GDrive Folder
              </a>
            )}
          </div>
        )}

        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Ready" value={s.found} color="green" />
            <StatCard label="Needs Review" value={s.needsReview} color="yellow" />
            <StatCard label="Missing" value={s.missing} color="red" />
            <StatCard label="N/A" value={s.notApplicable} color="blue" />
            <StatCard label="Errors" value={s.errors} color="red" />
          </div>
        )}

        <div className="flex items-center gap-2">
          {(["m1", "m2"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMilestone(m)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                milestone === m
                  ? "bg-orange-500 text-white"
                  : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {m === "m1" ? "M1 — Inspection Complete" : "M2 — Project Complete"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <PeAuditProgress
            dealId={dealId}
            milestone={milestone}
            onComplete={handleAuditComplete}
            onError={(msg) => console.error("Audit error:", msg)}
          />
          {hasResults && (
            <button
              onClick={handleAssemble}
              disabled={assembling}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              {assembling ? "Assembling..." : "Assemble Package"}
            </button>
          )}
          {auditRun?.packageFolderUrl && (
            <a
              href={auditRun.packageFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              View Package Folder
            </a>
          )}
        </div>

        {pandadocStatuses && pandadocStatuses.length > 0 && (
          <PePandaDocSection statuses={pandadocStatuses as Parameters<typeof PePandaDocSection>[0]["statuses"]} />
        )}

        {docCategories.map((cat) => (
          <div key={cat.name} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{cat.label}</h3>
            <div className="space-y-2">
              {cat.items
                .filter((r) => !r.item.isPhoto)
                .map((r) => (
                  <PeChecklistCard key={r.item.id} result={r as Parameters<typeof PeChecklistCard>[0]["result"]} />
                ))}
            </div>
          </div>
        ))}

        {photoResults.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Photos</h3>
            <PePhotoGrid
              photos={photoResults as Parameters<typeof PePhotoGrid>[0]["photos"]}
              onPhotoClick={(p) => setSelectedPhoto(p as Parameters<typeof PePhotoModal>[0]["photo"])}
            />
          </div>
        )}

        {/*
         * Site-photo gallery sourced directly from Zuper — same /api/deals/[id]/photos
         * endpoint the design meeting / deal detail pages use. Shows EVERY photo
         * attached to the linked Zuper jobs (job attachments + service-task form
         * submissions), not just the ones the audit auto-matched to a PE checklist
         * item. Useful when the audit flags a photo as missing and the PM wants to
         * verify whether any photo actually exists for that category.
         */}
        <PhotoGalleryCard hubspotDealId={dealId} />

        <PePhotoModal
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
        />

        {isLoading && (
          <div className="text-center py-12 text-muted">Loading audit data...</div>
        )}

        {!isLoading && !auditRun && (
          <div className="text-center py-12 text-muted">
            No audit has been run for this deal yet. Click &quot;Run Audit&quot; to start.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
