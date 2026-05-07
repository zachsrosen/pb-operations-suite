"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import DashboardShell from "@/components/DashboardShell";
import SyncStatus from "@/components/powerhub/SyncStatus";
import LinkDialog from "@/components/powerhub/LinkDialog";

export default function AdminPowerHubPage() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{
    siteId: string;
    siteName: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.powerhub.sites(),
    queryFn: async () => {
      const res = await fetch("/api/powerhub/sites");
      if (!res.ok) throw new Error("Failed to fetch sites");
      return res.json();
    },
  });

  async function handleForceSync(type: "assets" | "telemetry" | "alerts") {
    setSyncing(true);
    try {
      await fetch("/api/powerhub/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.powerhub.root });
    } finally {
      setSyncing(false);
    }
  }

  async function handleUnlink(siteId: string) {
    await fetch("/api/powerhub/unlink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId }),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.powerhub.root });
  }

  const sites = data?.sites || [];

  const lastAssetSync = sites[0]?.lastAssetSyncAt || null;
  const lastTelemetryPoll = sites.reduce(
    (latest: string | null, s: any) =>
      s.lastTelemetryAt && (!latest || s.lastTelemetryAt > latest)
        ? s.lastTelemetryAt
        : latest,
    null
  );
  const lastAlertPoll = sites.reduce(
    (latest: string | null, s: any) =>
      s.lastAlertCheckAt && (!latest || s.lastAlertCheckAt > latest)
        ? s.lastAlertCheckAt
        : latest,
    null
  );

  if (process.env.NEXT_PUBLIC_POWERHUB_ENABLED !== "true") {
    return null;
  }

  return (
    <DashboardShell title="PowerHub Site Linkage" accentColor="purple">
      <SyncStatus
        lastAssetSync={lastAssetSync}
        lastTelemetryPoll={lastTelemetryPoll}
        lastAlertPoll={lastAlertPoll}
        onForceSync={handleForceSync}
        syncing={syncing}
      />

      <div className="bg-surface rounded-xl p-4 shadow-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-t-border text-left text-muted">
              <th className="pb-3 pr-4 font-medium">Site</th>
              <th className="pb-3 pr-4 font-medium">Address</th>
              <th className="pb-3 pr-4 font-medium">Linked Deal</th>
              <th className="pb-3 pr-4 font-medium">Method</th>
              <th className="pb-3 pr-4 font-medium">Confidence</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site: any) => (
              <tr
                key={site.siteId}
                className="border-b border-t-border"
              >
                <td className="py-3 pr-4 font-medium text-foreground">
                  {site.siteName}
                </td>
                <td className="py-3 pr-4 text-muted">
                  {site.address}, {site.city}, {site.state}
                </td>
                <td className="py-3 pr-4">
                  {site.dealId ? (
                    <span className="text-foreground">Deal #{site.dealId}</span>
                  ) : (
                    <span className="text-yellow-500">— UNLINKED —</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-muted">{site.linkMethod}</td>
                <td className="py-3 pr-4 text-muted">{site.linkConfidence}</td>
                <td className="py-3">
                  {site.linkMethod === "UNLINKED" ? (
                    <button
                      onClick={() =>
                        setLinkTarget({
                          siteId: site.siteId,
                          siteName: site.siteName,
                        })
                      }
                      className="px-2 py-1 text-xs bg-cyan-600 text-white rounded hover:bg-cyan-700"
                    >
                      Link
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUnlink(site.siteId)}
                      className="px-2 py-1 text-xs text-red-500 hover:text-red-400"
                    >
                      Unlink
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {isLoading && (
          <div className="text-center py-8 text-muted">Loading sites...</div>
        )}
        {!isLoading && sites.length === 0 && (
          <div className="text-center py-8 text-muted">
            No PowerHub sites synced yet. Run an asset sync to discover sites.
          </div>
        )}
      </div>

      {linkTarget && (
        <LinkDialog
          siteId={linkTarget.siteId}
          siteName={linkTarget.siteName}
          onClose={() => setLinkTarget(null)}
          onLinked={() =>
            queryClient.invalidateQueries({ queryKey: queryKeys.powerhub.root })
          }
        />
      )}
    </DashboardShell>
  );
}
