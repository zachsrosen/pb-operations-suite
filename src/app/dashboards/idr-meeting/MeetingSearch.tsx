"use client";

import { useState, useCallback } from "react";
import { SearchResultsList } from "./SearchResultsList";
import { DealHistoryDetail } from "./DealHistoryDetail";

interface SelectedDeal {
  dealId: string;
  dealName: string;
  region: string | null;
  systemSizeKw: number | null;
  projectType: string | null;
}

export function MeetingSearch() {
  const [selectedDeal, setSelectedDeal] = useState<SelectedDeal | null>(null);

  const handleFiltersChange = useCallback(() => setSelectedDeal(null), []);

  return (
    <div className="flex gap-0 h-[calc(100vh-13rem)] overflow-hidden rounded-xl border border-t-border">
      <SearchResultsList
        selectedDealId={selectedDeal?.dealId ?? null}
        onSelectDeal={(dealId, dealName, region, systemSizeKw, projectType) =>
          setSelectedDeal({ dealId, dealName, region, systemSizeKw, projectType })
        }
        onFiltersChange={handleFiltersChange}
      />

      {selectedDeal ? (
        <DealHistoryDetail
          key={selectedDeal.dealId}
          dealId={selectedDeal.dealId}
          dealName={selectedDeal.dealName}
          region={selectedDeal.region}
          systemSizeKw={selectedDeal.systemSizeKw}
          projectType={selectedDeal.projectType}
        />
      ) : (
        <div className="flex-1 rounded-xl bg-surface flex items-center justify-center">
          <p className="text-sm text-muted">Select a deal from the results to view its history</p>
        </div>
      )}
    </div>
  );
}
