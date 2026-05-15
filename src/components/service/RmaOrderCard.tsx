"use client";

import { useState } from "react";
import { getZohoSalesOrderUrl } from "@/lib/external-links";
import type { RmaLineItem } from "@/lib/zoho-so-helpers";

interface RmaOrderData {
  id: string;
  ticketId: string;
  ticketSubject: string;
  status: "DRAFT" | "SO_CREATED" | "RETURN_PENDING" | "CLOSED";
  outboundItems: RmaLineItem[];
  inboundItems: RmaLineItem[] | null;
  zohoSoId: string | null;
  zohoSoNumber: string | null;
  pbLocation: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

interface Props {
  order: RmaOrderData;
  onSoCreated: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-yellow-500/15 text-yellow-400 ring-yellow-500/30",
  SO_CREATED: "bg-green-500/15 text-green-400 ring-green-500/30",
  RETURN_PENDING: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
  CLOSED: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
};

export default function RmaOrderCard({ order, onSoCreated }: Props) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCustomer, setNeedsCustomer] = useState(false);
  const [customerId, setCustomerId] = useState("");

  const handleCreateSo = async (overrideCustomerId?: string) => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/service/rma/${order.id}/create-so`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          overrideCustomerId ? { customerId: overrideCustomerId } : {}
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsCustomerId) {
          setNeedsCustomer(true);
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onSoCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create SO");
    } finally {
      setCreating(false);
    }
  };

  const outbound = order.outboundItems ?? [];
  const inbound = order.inboundItems ?? [];

  return (
    <div className="rounded-xl border border-t-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_BADGE[order.status] ?? STATUS_BADGE.CLOSED}`}
        >
          {order.status.replace("_", " ")}
        </span>
        <span className="text-xs text-muted">
          {new Date(order.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted mb-1">Replacing</div>
          {inbound.length > 0 ? (
            inbound.map((i, idx) => (
              <div key={idx} className="text-foreground">
                {i.brand} {i.model} &times;{i.quantity}
              </div>
            ))
          ) : (
            <div className="text-muted italic">Not specified</div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted mb-1">Sending</div>
          {outbound.map((i, idx) => (
            <div key={idx} className="text-foreground">
              {i.brand} {i.model} &times;{i.quantity}
            </div>
          ))}
        </div>
      </div>

      {order.notes && (
        <div className="text-xs text-muted">{order.notes}</div>
      )}

      {order.status === "DRAFT" && (
        <div className="space-y-2">
          {needsCustomer && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Zoho Customer ID"
                className="flex-1 bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
              />
              <button
                onClick={() => handleCreateSo(customerId)}
                disabled={creating || !customerId.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              >
                Retry
              </button>
            </div>
          )}
          {!needsCustomer && (
            <button
              onClick={() => handleCreateSo()}
              disabled={creating}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? "Creating SO..." : "Create Sales Order"}
            </button>
          )}
          {error && <div className="text-sm text-red-400">{error}</div>}
        </div>
      )}

      {order.status === "SO_CREATED" && order.zohoSoId && (
        <a
          href={getZohoSalesOrderUrl(order.zohoSoId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-green-400 hover:text-green-300"
        >
          {order.zohoSoNumber ?? "View SO"} &#8599;
        </a>
      )}
    </div>
  );
}
