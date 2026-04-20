"use client";

import { useState } from "react";
import { PoolConfigCard } from "./PoolConfigCard";
import { PublishCard } from "./PublishCard";
import { HolidaysPanel } from "./HolidaysPanel";

type Pool = {
  id: string;
  name: string;
  region: string;
  shiftStart: string;
  shiftEnd: string;
  timezone: string;
  startDate: string;
  horizonMonths: number;
  isActive: boolean;
  lastPublishedAt: Date | string | null;
  lastPublishedThrough: string | null;
  icalToken: string | null;
  _count?: { members: number; assignments: number };
};

export function OnCallSetupClient({ initialPools }: { initialPools: Pool[] }) {
  const [selectedId, setSelectedId] = useState(initialPools[0]?.id ?? null);
  const selected = initialPools.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      {initialPools.length === 0 && (
        <div className="bg-surface border border-t-border rounded-lg p-8 text-center text-muted">
          <p className="mb-4">No on-call pools configured yet.</p>
          <p className="text-sm">Run the seed script <code>scripts/seed-on-call-pools.ts</code> to create the three starter pools (California, Denver, Southern CO).</p>
        </div>
      )}

      {initialPools.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {initialPools.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  selectedId === p.id
                    ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
                    : "bg-surface border border-t-border text-muted hover:text-foreground"
                }`}
              >
                {p.name} <span className="opacity-60 ml-1">({p._count?.members ?? 0})</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PoolConfigCard pool={selected} />
              <PublishCard pool={selected} />
            </div>
          )}

          <HolidaysPanel />
        </>
      )}
    </div>
  );
}
