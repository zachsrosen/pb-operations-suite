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

interface AuditRunData {
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
        foundFile?: { name: string; id: string; url: string; modifiedTime: string; size: number };
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

  return (
    <DashboardShell
      title={auditRun?.dealName ? `PE Prep: ${auditRun.dealName}` : "PE File Preparation"}
      accentColor="orange"
      lastUpdated={lastAuditLabel}
      fullWidth
    >
      <div className="space-y-6">
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
