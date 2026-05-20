"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import type { IdrItem } from "./IdrMeetingClient";

interface BomItem {
  id: string; // client-side ID
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
  source?: string;
  flags?: string[];
  confirmed?: boolean; // local UI state
}

interface BomSnapshot {
  id: string;
  version: number;
  bomData: {
    project: Record<string, unknown>;
    items: Omit<BomItem, "id" | "confirmed">[];
    validation?: Record<string, unknown>;
  };
  sourceFile: string | null;
  savedBy: string | null;
  createdAt: string;
}

interface Props {
  item: IdrItem;
  readOnly: boolean;
}

let globalNextId = 1;
function assignIds(items: Omit<BomItem, "id" | "confirmed">[]): BomItem[] {
  return items.map((it) => ({ ...it, id: String(globalNextId++), confirmed: false }));
}

const CATEGORIES = [
  "MODULE", "INVERTER", "BATTERY", "BATTERY_EXPANSION",
  "EV_CHARGER", "RACKING", "ELECTRICAL_BOS", "MONITORING", "RAPID_SHUTDOWN",
] as const;

export function BomExtractionEditor({ item, readOnly }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const nextIdRef = useRef(globalNextId);

  // Fetch existing snapshot
  const snapshotQuery = useQuery({
    queryKey: [...queryKeys.idrMeeting.root, "bomSnapshot", item.dealId],
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/bom-extract/${item.dealId}`);
      if (!res.ok) throw new Error("Failed to fetch BOM snapshot");
      return res.json() as Promise<{ snapshot: BomSnapshot | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Load snapshot into editor on first fetch
  useEffect(() => {
    if (snapshotQuery.data?.snapshot && !loaded) {
      const snap = snapshotQuery.data.snapshot;
      setBomItems(assignIds(snap.bomData.items));
      setSnapshotId(snap.id);
      setLoaded(true);
    }
  }, [snapshotQuery.data, loaded]);

  // -- Inline editing --
  const updateItem = useCallback((id: string, field: keyof BomItem, value: string | number | null) => {
    setBomItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)),
    );
  }, []);

  const deleteItem = useCallback((id: string) => {
    setBomItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const toggleConfirm = useCallback((id: string) => {
    setBomItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, confirmed: !it.confirmed } : it)),
    );
  }, []);

  const addRow = useCallback(() => {
    const newId = nextIdRef.current++;
    setBomItems((prev) => [
      ...prev,
      {
        id: String(newId),
        category: "ELECTRICAL_BOS",
        brand: "",
        model: "",
        description: "",
        qty: 1,
        confirmed: false,
      },
    ]);
  }, []);

  // -- On-demand extraction --
  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const res = await fetch(`/api/idr-meeting/bom-extract/${item.dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealName: item.dealName,
          designFolderUrl: item.designFolderUrl,
        }),
      });
      const data = await res.json() as { status: string; snapshotId?: string; error?: string; itemCount?: number };
      if (data.status === "failed") {
        addToast({ type: "error", title: data.error || "Extraction failed" });
        return;
      }
      addToast({ type: "success", title: `Extracted ${data.itemCount ?? 0} items` });
      setSnapshotId(data.snapshotId || null);
      // Refetch snapshot to populate editor
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.idrMeeting.root, "bomSnapshot", item.dealId],
      });
      setLoaded(false); // allow reload from new snapshot
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Extraction failed" });
    } finally {
      setExtracting(false);
    }
  }, [item.dealId, item.dealName, item.designFolderUrl, addToast, queryClient]);

  // -- Save snapshot --
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/bom/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: item.dealId,
          dealName: item.dealName,
          bomData: {
            project: {},
            items: bomItems.map(({ id: _id, confirmed: _c, ...rest }) => rest),
          },
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json() as { id?: string };
      setSnapshotId(data.id || null);
      addToast({ type: "success", title: "BOM snapshot saved" });
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [item.dealId, item.dealName, bomItems, addToast]);

  // -- Push to HubSpot --
  const handlePush = useCallback(async () => {
    setPushing(true);
    try {
      // Ensure we have a saved snapshot
      let currentSnapshotId = snapshotId;
      if (!currentSnapshotId) {
        const saveRes = await fetch("/api/bom/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealId: item.dealId,
            dealName: item.dealName,
            bomData: {
              project: {},
              items: bomItems.map(({ id: _id, confirmed: _c, ...rest }) => rest),
            },
          }),
        });
        if (!saveRes.ok) throw new Error("Failed to save snapshot before push");
        const saveData = await saveRes.json() as { id?: string };
        currentSnapshotId = saveData.id || null;
        setSnapshotId(currentSnapshotId);
      }

      if (!currentSnapshotId) throw new Error("No snapshot ID available");

      const res = await fetch("/api/bom/push-to-hubspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: item.dealId,
          snapshotId: currentSnapshotId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Push failed (${res.status})`);
      }
      addToast({ type: "success", title: "BOM pushed to HubSpot line items" });
      // Refresh line items
      queryClient.invalidateQueries({
        queryKey: [...queryKeys.idrMeeting.root, "lineItems", item.dealId],
      });
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Push failed" });
    } finally {
      setPushing(false);
    }
  }, [item.dealId, item.dealName, bomItems, snapshotId, addToast, queryClient]);

  const hasSnapshot = snapshotQuery.data?.snapshot != null || bomItems.length > 0;

  // -- No snapshot + no extraction yet --
  if (!hasSnapshot && !snapshotQuery.isLoading) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleExtract}
          disabled={extracting || !item.designFolderUrl}
          className="rounded bg-cyan-500/10 border border-cyan-500/30 px-2.5 py-1.5 text-xs font-medium
            text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
        >
          {extracting ? "Extracting..." : "Extract BOM"}
        </button>
        {!item.designFolderUrl && (
          <span className="text-[10px] text-muted">No design folder linked</span>
        )}
        {extracting && (
          <span className="text-[10px] text-muted">Reading planset with Claude (~30-60s)...</span>
        )}
      </div>
    );
  }

  if (snapshotQuery.isLoading) {
    return <div className="h-8 w-48 rounded bg-surface-2 animate-pulse" />;
  }

  // -- Editor --
  return (
    <div className="space-y-2">
      {/* Status bar */}
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {bomItems.length} items
        </span>
        {snapshotQuery.data?.snapshot?.sourceFile && (
          <span>from {snapshotQuery.data.snapshot.sourceFile}</span>
        )}
        <button
          onClick={handleExtract}
          disabled={extracting}
          className="ml-auto text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
        >
          {extracting ? "Extracting..." : "Re-extract"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted text-left">
              <th className="pb-1 pr-2 font-medium">Category</th>
              <th className="pb-1 pr-2 font-medium">Brand / Model</th>
              <th className="pb-1 pr-2 font-medium w-14 text-center">Qty</th>
              <th className="pb-1 font-medium w-16 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bomItems.map((bi) => (
              <tr
                key={bi.id}
                className={`border-t border-t-border/50 ${bi.confirmed ? "opacity-60" : ""}`}
              >
                <td className="py-1 pr-2">
                  {readOnly ? (
                    <span>{bi.category}</span>
                  ) : (
                    <select
                      value={bi.category}
                      onChange={(e) => updateItem(bi.id, "category", e.target.value)}
                      className="rounded bg-surface-2 px-1 py-0.5 text-xs text-foreground border-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="py-1 pr-2">
                  {readOnly ? (
                    <span>{bi.brand} {bi.model}</span>
                  ) : (
                    <div className="flex gap-1">
                      <input
                        value={bi.brand ?? ""}
                        onChange={(e) => updateItem(bi.id, "brand", e.target.value)}
                        placeholder="Brand"
                        className="w-24 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
                      />
                      <input
                        value={bi.model ?? ""}
                        onChange={(e) => updateItem(bi.id, "model", e.target.value)}
                        placeholder="Model"
                        className="flex-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
                      />
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2 text-center">
                  {readOnly ? (
                    <span>{bi.qty}</span>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={bi.qty}
                      onChange={(e) => updateItem(bi.id, "qty", parseInt(e.target.value) || 1)}
                      className="w-12 rounded bg-surface-2 px-1 py-0.5 text-xs text-foreground text-center"
                    />
                  )}
                </td>
                <td className="py-1 text-center">
                  {!readOnly && (
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => toggleConfirm(bi.id)}
                        title={bi.confirmed ? "Unconfirm" : "Confirm"}
                        className={`text-xs ${bi.confirmed ? "text-emerald-400" : "text-muted hover:text-emerald-400"}`}
                      >
                        &#10003;
                      </button>
                      <button
                        onClick={() => deleteItem(bi.id)}
                        title="Remove"
                        className="text-xs text-muted hover:text-red-400"
                      >
                        &#10007;
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button
            onClick={addRow}
            className="text-xs text-muted hover:text-foreground"
          >
            + Add Row
          </button>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving || bomItems.length === 0}
              className="rounded border border-t-border px-2.5 py-1 text-xs font-medium text-foreground
                hover:bg-surface-2 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save Snapshot"}
            </button>
            <button
              onClick={handlePush}
              disabled={pushing || bomItems.length === 0}
              className="rounded bg-orange-500/10 border border-orange-500/30 px-2.5 py-1 text-xs font-medium
                text-orange-400 hover:bg-orange-500/20 disabled:opacity-50 transition-colors"
            >
              {pushing ? "Pushing..." : "Push to HubSpot"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
