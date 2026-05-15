"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import RmaCreateFlow from "./RmaCreateFlow";
import RmaOrderCard from "./RmaOrderCard";

const RMA_ENABLED = process.env.NEXT_PUBLIC_RMA_ENABLED === "true";

interface Props {
  ticketId: string;
  ticketSubject: string;
  pbLocation: string | null;
}

export default function RmaSection({ ticketId, ticketSubject, pbLocation }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["rma-orders", ticketId],
    queryFn: async () => {
      const res = await fetch(`/api/service/rma?ticketId=${encodeURIComponent(ticketId)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: RMA_ENABLED,
    staleTime: 30_000,
  });

  if (!RMA_ENABLED) return null;

  const refetchOrders = () => {
    queryClient.invalidateQueries({ queryKey: ["rma-orders", ticketId] });
    setShowCreate(false);
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">RMA</h3>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            + Create RMA
          </button>
        )}
      </div>

      {showCreate && (
        <RmaCreateFlow
          ticketId={ticketId}
          ticketSubject={ticketSubject}
          pbLocation={pbLocation}
          onCreated={refetchOrders}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {isLoading && (
        <div className="text-xs text-muted">Loading RMAs...</div>
      )}

      {!isLoading && orders.length === 0 && !showCreate && (
        <div className="text-xs text-muted">No RMAs</div>
      )}

      {orders.length > 0 && (
        <div className="space-y-3 mt-3">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {orders.map((order: any) => (
            <RmaOrderCard
              key={order.id}
              order={order}
              onSoCreated={refetchOrders}
            />
          ))}
        </div>
      )}
    </div>
  );
}
