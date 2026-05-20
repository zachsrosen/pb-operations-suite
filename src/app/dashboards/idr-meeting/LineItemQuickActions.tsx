"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";
import { LINE_ITEM_PRESETS, type LineItemPreset } from "@/lib/idr-line-item-presets";

interface LineItem {
  id: string;
  name: string;
  quantity: number;
  manufacturer: string;
  productCategory: string;
  sku: string;
  price: number;
  amount: number;
  hubspotProductId: string | null;
}

interface Props {
  dealId: string;
  lineItems: LineItem[] | undefined;
  isLoading: boolean;
  onOpenCatalogSearch: () => void;
}

export function LineItemQuickActions({ dealId, lineItems, isLoading, onOpenCatalogSearch }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [addingPreset, setAddingPreset] = useState<string | null>(null);

  const lineItemKey = [...queryKeys.idrMeeting.root, "lineItems", dealId];

  const addPresetMutation = useMutation({
    mutationFn: async (preset: LineItemPreset) => {
      setAddingPreset(preset.label);
      const res = await fetch(`/api/idr-meeting/line-items/${dealId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internalProductId: preset.internalProductId,
          quantity: preset.defaultQty,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, preset) => {
      addToast({ type: "success", title: `Added ${preset.label}` });
      queryClient.invalidateQueries({ queryKey: lineItemKey });
    },
    onError: (err: Error, preset) => {
      addToast({ type: "error", title: `Failed to add ${preset.label}: ${err.message}` });
    },
    onSettled: () => setAddingPreset(null),
  });

  // Check if a preset's product already exists in the line items
  const isPresetOnDeal = useCallback(
    (preset: LineItemPreset) => {
      if (!lineItems) return false;
      const label = preset.label.toLowerCase();
      return lineItems.some((li) => li.name.toLowerCase().includes(label));
    },
    [lineItems],
  );

  // Find module line items for +/- count
  const moduleItems = lineItems?.filter(
    (li) => li.productCategory?.toUpperCase() === "MODULE" || li.name?.toLowerCase().includes("module"),
  ) ?? [];
  const totalModuleQty = moduleItems.reduce((sum, li) => sum + li.quantity, 0);

  return (
    <div className="space-y-2">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {LINE_ITEM_PRESETS.map((preset) => {
          const onDeal = isPresetOnDeal(preset);
          const isAdding = addingPreset === preset.label;
          return (
            <button
              key={preset.label}
              onClick={() => addPresetMutation.mutate(preset)}
              disabled={isAdding}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors
                ${onDeal
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-surface-2 text-foreground hover:bg-surface-2/80 border border-t-border"
                }
                disabled:opacity-50`}
            >
              {isAdding ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : onDeal ? (
                <span>&#10003;</span>
              ) : (
                <span>+</span>
              )}
              {preset.label}
            </button>
          );
        })}

        {/* Module count adjuster */}
        {moduleItems.length > 0 && (
          <ModuleCountAdjuster
            dealId={dealId}
            moduleItems={moduleItems}
            totalQty={totalModuleQty}
            lineItemKey={lineItemKey}
          />
        )}

        {/* Add from catalog */}
        <button
          onClick={onOpenCatalogSearch}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium
            bg-surface-2 text-muted hover:text-foreground hover:bg-surface-2/80 border border-t-border transition-colors"
        >
          + Add Item&hellip;
        </button>
      </div>

      {/* Current line items list */}
      <div className="space-y-0.5">
        {isLoading && <div className="h-4 w-48 rounded bg-surface-2 animate-pulse" />}
        {lineItems && lineItems.length > 0 ? (
          lineItems.map((li, i) => (
            <div key={li.id || i} className="flex items-center justify-between text-xs text-foreground">
              <span className="truncate">{li.name}</span>
              <span className="text-muted ml-2 shrink-0">x{li.quantity}</span>
            </div>
          ))
        ) : lineItems ? (
          <p className="text-xs text-muted">No line items on deal</p>
        ) : null}
      </div>
    </div>
  );
}

/* -- Module count +/- sub-component ---------------------------------------- */

function ModuleCountAdjuster({
  dealId,
  moduleItems,
  totalQty,
  lineItemKey,
}: {
  dealId: string;
  moduleItems: LineItem[];
  totalQty: number;
  lineItemKey: unknown[];
}) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [adjusting, setAdjusting] = useState(false);

  const adjust = useCallback(
    async (delta: number) => {
      const target = moduleItems[0];
      if (!target?.id) {
        addToast({ type: "error", title: "Cannot adjust - line item ID not available" });
        return;
      }
      const newQty = Math.max(1, target.quantity + delta);
      if (newQty === target.quantity) return;

      setAdjusting(true);
      try {
        const res = await fetch(`/api/idr-meeting/line-items/${dealId}/quantity`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineItemId: target.id, quantity: newQty }),
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        addToast({ type: "success", title: `Module count updated to ${newQty}` });
        queryClient.invalidateQueries({ queryKey: lineItemKey });
      } catch (err) {
        addToast({ type: "error", title: err instanceof Error ? err.message : "Failed to adjust" });
      } finally {
        setAdjusting(false);
      }
    },
    [moduleItems, dealId, addToast, queryClient, lineItemKey],
  );

  return (
    <div className="inline-flex items-center gap-0.5 rounded border border-t-border bg-surface-2 px-1">
      <button
        onClick={() => adjust(-1)}
        disabled={adjusting || totalQty <= 1}
        className="px-1 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-30"
      >
        &minus;
      </button>
      <span className="px-1 text-xs font-medium text-foreground">
        {adjusting ? "..." : totalQty} modules
      </span>
      <button
        onClick={() => adjust(1)}
        disabled={adjusting}
        className="px-1 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}
