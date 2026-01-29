"use client";

import { LOCATIONS, ACTIVE_STAGES, type LocationKey } from "@/lib/config";

export interface FilterState {
  location: string;
  stage: string;
  pe: "all" | "pe" | "non-pe";
  search: string;
}

export interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  showPeFilter?: boolean;
  showStageFilter?: boolean;
  showSearchFilter?: boolean;
}

export function FilterBar({
  filters,
  onChange,
  showPeFilter = true,
  showStageFilter = true,
  showSearchFilter = true,
}: FilterBarProps) {
  const handleChange = (key: keyof FilterState, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="flex gap-4 mb-6 flex-wrap items-center bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      {/* Location Filter */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500">Location</label>
        <select
          value={filters.location}
          onChange={(e) => handleChange("location", e.target.value)}
          className="input-dark"
        >
          <option value="all">All Locations</option>
          {Object.keys(LOCATIONS).map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>

      {/* Stage Filter */}
      {showStageFilter && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Stage</label>
          <select
            value={filters.stage}
            onChange={(e) => handleChange("stage", e.target.value)}
            className="input-dark"
          >
            <option value="all">All Stages</option>
            {ACTIVE_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* PE Filter */}
      {showPeFilter && (
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              handleChange("pe", filters.pe === "pe" ? "all" : "pe")
            }
            className={`filter-btn ${filters.pe === "pe" ? "pe-active" : ""}`}
          >
            PE Only
          </button>
        </div>
      )}

      {/* Search Filter */}
      {showSearchFilter && (
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search projects..."
            value={filters.search}
            onChange={(e) => handleChange("search", e.target.value)}
            className="input-dark w-full"
          />
        </div>
      )}
    </div>
  );
}

export function QuickFilterButtons({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`filter-btn ${value === option.value ? "active" : ""}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
