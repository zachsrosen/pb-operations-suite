/**
 * EagleViewPanel — manual TrueDesign order button + status display.
 *
 * Renders one of these states:
 *   - Loading       (initial fetch)
 *   - Never ordered ("Pull EagleView Files" button)
 *   - ORDERED       (in progress + relative timestamp)
 *   - DELIVERED     (file links + relative timestamp)
 *   - FAILED        (error + retry)
 *
 * Designed to drop into Solar Surveyor shell + deal detail sidebar.
 */
"use client";

import { useEffect, useState, useCallback } from "react";

interface EagleViewOrder {
  id: string;
  dealId: string;
  reportId: string;
  status: "ORDERED" | "DELIVERED" | "FAILED" | "CANCELLED";
  orderedAt: string;
  deliveredAt: string | null;
  errorMessage: string | null;
  driveFolderId: string | null;
  imageDriveFileId: string | null;
  layoutJsonDriveFileId: string | null;
  shadeJsonDriveFileId: string | null;
  reportPdfDriveFileId: string | null;
  reportXmlDriveFileId: string | null;
  triggeredBy: string;
}

interface OrderResponse {
  order: EagleViewOrder | null;
}

interface Props {
  dealId: string;
}

export function EagleViewPanel({ dealId }: Props) {
  const [order, setOrder] = useState<EagleViewOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/eagleview/order?dealId=${encodeURIComponent(dealId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as OrderResponse;
      setOrder(data.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const placeOrder = useCallback(
    async (force = false) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/eagleview/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId, force }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `Status ${res.status}`);
        }
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : "order_failed");
      } finally {
        setSubmitting(false);
      }
    },
    [dealId, refetch],
  );

  if (loading) {
    return (
      <div className="bg-surface rounded-lg p-4 border border-t-border">
        <div className="text-sm text-muted">Loading EagleView status…</div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-lg p-4 border border-t-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">EagleView TrueDesign</h3>
        {order && <StatusBadge status={order.status} />}
      </div>

      {error && (
        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded px-2 py-1">
          {error}
        </div>
      )}

      {!order && (
        <button
          type="button"
          disabled={submitting}
          onClick={() => placeOrder(false)}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded px-3 py-2 disabled:opacity-60"
        >
          {submitting ? "Ordering…" : "Pull EagleView Files"}
        </button>
      )}

      {order?.status === "ORDERED" && (
        <div className="text-xs text-muted">
          Ordered {relativeTime(order.orderedAt)} — files arrive within ~30 min.
          Report #{order.reportId}
        </div>
      )}

      {order?.status === "DELIVERED" && (
        <div className="space-y-2">
          <div className="text-xs text-muted">
            Delivered {order.deliveredAt ? relativeTime(order.deliveredAt) : "recently"}.
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {order.driveFolderId && (
              <DriveLink fileId={order.driveFolderId} label="Folder" isFolder />
            )}
            {order.imageDriveFileId && (
              <DriveLink fileId={order.imageDriveFileId} label="Aerial" />
            )}
            {order.layoutJsonDriveFileId && (
              <DriveLink fileId={order.layoutJsonDriveFileId} label="Layout" />
            )}
            {order.shadeJsonDriveFileId && (
              <DriveLink fileId={order.shadeJsonDriveFileId} label="Shade" />
            )}
            {order.reportPdfDriveFileId && (
              <DriveLink fileId={order.reportPdfDriveFileId} label="Report PDF" />
            )}
          </div>
        </div>
      )}

      {order?.status === "FAILED" && (
        <div className="space-y-2">
          <div className="text-xs text-red-500">
            Failed: {order.errorMessage ?? "unknown reason"}
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => placeOrder(true)}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded px-3 py-2 disabled:opacity-60"
          >
            {submitting ? "Retrying…" : "Retry Order"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: EagleViewOrder["status"] }) {
  const cls = {
    ORDERED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    DELIVERED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    FAILED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    CANCELLED: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-200",
  }[status];
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${cls}`}>
      {status}
    </span>
  );
}

function DriveLink({ fileId, label, isFolder = false }: { fileId: string; label: string; isFolder?: boolean }) {
  const url = isFolder
    ? `https://drive.google.com/drive/folders/${fileId}`
    : `https://drive.google.com/file/d/${fileId}/view`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="px-2 py-1 bg-surface-2 hover:bg-surface-elevated rounded text-foreground"
    >
      {label}
    </a>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "recently";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
