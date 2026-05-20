"use client";

import { useState } from "react";
import type { IdrItem } from "./IdrMeetingClient";
import { LineItemQuickActions } from "./LineItemQuickActions";
import { AddLineItemDialog } from "./AddLineItemDialog";
import { BomExtractionEditor } from "./BomExtractionEditor";

interface LineItem {
  name: string;
  quantity: number;
  manufacturer: string;
  productCategory: string;
  sku: string;
  price: number;
  amount: number;
  hubspotProductId?: string;
  id?: string;
}

interface Props {
  item: IdrItem;
  lineItems: LineItem[] | undefined;
  lineItemsLoading: boolean;
  readOnly: boolean;
}

export function BomReviewSection({ item, lineItems, lineItemsLoading, readOnly }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/50">
      {/* Header - collapsible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-3"
      >
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          BOM Review
        </h3>
        <span className="text-xs text-muted">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-4">
          {/* Line Item Quick Actions */}
          <div>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted mb-1.5">
              Line Items
            </p>
            <LineItemQuickActions
              dealId={item.dealId}
              lineItems={lineItems}
              isLoading={lineItemsLoading}
              onOpenCatalogSearch={() => setCatalogOpen(true)}
            />
          </div>

          {/* BOM Extraction Editor */}
          <div>
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted mb-1.5">
              BOM Extraction
            </p>
            <BomExtractionEditor item={item} readOnly={readOnly} />
          </div>
        </div>
      )}

      {/* Catalog search dialog */}
      <AddLineItemDialog
        dealId={item.dealId}
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
      />
    </div>
  );
}
