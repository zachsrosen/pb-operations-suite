"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";

// ---- Types ----

export interface FilterOption {
  value: string;
  label: string;
  group?: string;
  subgroup?: string;
}

export interface FilterGroup {
  name: string;
  subgroups?: { name: string; options: FilterOption[] }[];
  options?: FilterOption[];
}

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  groups?: FilterGroup[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  accentColor?: string;
}

// ---- Component ----

export const MultiSelectFilter = memo(function MultiSelectFilter({
  label,
  options,
  groups,
  selected,
  onChange,
  placeholder = "All",
  accentColor = "indigo",
}: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = useCallback((value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }, [selected, onChange]);

  const selectGroup = useCallback((groupOptions: FilterOption[]) => {
    const values = groupOptions.map(o => o.value);
    const allSelected = values.every(v => selected.includes(v));
    if (allSelected) {
      // Deselect all in group
      onChange(selected.filter(v => !values.includes(v)));
    } else {
      // Select all in group
      const newSelected = [...new Set([...selected, ...values])];
      onChange(newSelected);
    }
  }, [selected, onChange]);

  const clearAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  const selectAll = useCallback(() => {
    onChange(options.map(o => o.value));
  }, [options, onChange]);

  // Filter options by search
  const filterBySearch = useCallback((opts: FilterOption[]) => {
    if (!search) return opts;
    const lower = search.toLowerCase();
    return opts.filter(o =>
      o.label.toLowerCase().includes(lower) ||
      o.value.toLowerCase().includes(lower)
    );
  }, [search]);

  // Get display text
  const displayText = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label || selected[0]
      : `${selected.length} selected`;

  const accentClasses: Record<string, string> = {
    indigo: "bg-indigo-500/20 text-indigo-400 border-indigo-500/50",
    orange: "bg-orange-500/20 text-orange-400 border-orange-500/50",
    blue: "bg-blue-500/20 text-blue-400 border-blue-500/50",
    green: "bg-green-500/20 text-green-400 border-green-500/50",
    purple: "bg-purple-500/20 text-purple-400 border-purple-500/50",
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
          selected.length > 0
            ? accentClasses[accentColor] || accentClasses.indigo
            : "bg-surface-2 border-t-border text-foreground/80 hover:border-muted"
        }`}
      >
        <span className="text-muted text-xs">{label}:</span>
        <span className="font-medium">{displayText}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-72 max-h-96 overflow-auto bg-surface border border-t-border rounded-lg shadow-card-lg">
          {/* Search */}
          <div className="p-2 border-b border-t-border sticky top-0 bg-surface">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full px-3 py-1.5 bg-surface-2 border border-t-border rounded text-sm focus:outline-none focus:border-muted"
              autoFocus
            />
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 p-2 border-b border-t-border">
            <button
              onClick={selectAll}
              className="text-xs px-2 py-1 bg-surface-2 hover:bg-surface-elevated rounded"
            >
              Select All
            </button>
            <button
              onClick={clearAll}
              className="text-xs px-2 py-1 bg-surface-2 hover:bg-surface-elevated rounded"
            >
              Clear All
            </button>
          </div>

          {/* Options */}
          <div className="p-1">
            {groups ? (
              // Grouped options
              groups.map((group) => {
                const groupOptions = group.options || [];
                const subgroups = group.subgroups || [];
                const allGroupOptions = [
                  ...groupOptions,
                  ...subgroups.flatMap(sg => sg.options)
                ];
                const filteredGroupOptions = filterBySearch(allGroupOptions);

                if (filteredGroupOptions.length === 0) return null;

                const allSelected = filteredGroupOptions.every(o => selected.includes(o.value));
                const someSelected = filteredGroupOptions.some(o => selected.includes(o.value));

                return (
                  <div key={group.name} className="mb-2">
                    {/* Group header */}
                    <button
                      onClick={() => selectGroup(filteredGroupOptions)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs font-semibold text-muted uppercase tracking-wider hover:bg-surface-2 rounded"
                    >
                      <span className={`w-3 h-3 border rounded-sm flex items-center justify-center ${
                        allSelected ? "bg-indigo-500 border-indigo-500" :
                        someSelected ? "bg-indigo-500/50 border-indigo-500" : "border-muted"
                      }`}>
                        {(allSelected || someSelected) && (
                          <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </span>
                      {group.name}
                    </button>

                    {/* Subgroups */}
                    {subgroups.map((subgroup) => {
                      const filteredSubOptions = filterBySearch(subgroup.options);
                      if (filteredSubOptions.length === 0) return null;

                      const subAllSelected = filteredSubOptions.every(o => selected.includes(o.value));
                      const subSomeSelected = filteredSubOptions.some(o => selected.includes(o.value));

                      return (
                        <div key={subgroup.name} className="ml-3">
                          <button
                            onClick={() => selectGroup(filteredSubOptions)}
                            className="flex items-center gap-2 w-full px-2 py-1 text-left text-xs text-muted hover:bg-surface-2 rounded"
                          >
                            <span className={`w-2.5 h-2.5 border rounded-sm flex items-center justify-center ${
                              subAllSelected ? "bg-indigo-500 border-indigo-500" :
                              subSomeSelected ? "bg-indigo-500/50 border-indigo-500" : "border-muted"
                            }`}>
                              {(subAllSelected || subSomeSelected) && (
                                <svg className="w-1.5 h-1.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </span>
                            {subgroup.name}
                          </button>
                          {/* Individual options in subgroup */}
                          {filteredSubOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => toggleOption(option.value)}
                              className="flex items-center gap-2 w-full px-2 py-1 ml-3 text-left text-sm text-foreground/80 hover:bg-surface-2 rounded"
                            >
                              <span className={`w-3 h-3 border rounded flex items-center justify-center ${
                                selected.includes(option.value) ? "bg-indigo-500 border-indigo-500" : "border-muted"
                              }`}>
                                {selected.includes(option.value) && (
                                  <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </span>
                              {option.label}
                            </button>
                          ))}
                        </div>
                      );
                    })}

                    {/* Direct options in group (not in subgroups) */}
                    {filterBySearch(groupOptions).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => toggleOption(option.value)}
                        className="flex items-center gap-2 w-full px-2 py-1 ml-3 text-left text-sm text-foreground/80 hover:bg-surface-2 rounded"
                      >
                        <span className={`w-3 h-3 border rounded flex items-center justify-center ${
                          selected.includes(option.value) ? "bg-indigo-500 border-indigo-500" : "border-muted"
                        }`}>
                          {selected.includes(option.value) && (
                            <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </span>
                        {option.label}
                      </button>
                    ))}
                  </div>
                );
              })
            ) : (
              // Flat options
              filterBySearch(options).map((option) => (
                <button
                  key={option.value}
                  onClick={() => toggleOption(option.value)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm text-foreground/80 hover:bg-surface-2 rounded"
                >
                  <span className={`w-3 h-3 border rounded flex items-center justify-center ${
                    selected.includes(option.value) ? "bg-indigo-500 border-indigo-500" : "border-muted"
                  }`}>
                    {selected.includes(option.value) && (
                      <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </span>
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ---- Search Bar Component ----

interface ProjectSearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export const ProjectSearchBar = memo(function ProjectSearchBar({
  onSearch,
  placeholder = "Search by PROJ #, name, or address...",
}: ProjectSearchBarProps) {
  const [query, setQuery] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    onSearch(value);
  };

  const handleClear = () => {
    setQuery("");
    onSearch("");
  };

  return (
    <div className="relative flex-1 max-w-md">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full pl-10 pr-8 py-2 bg-surface-2 border border-t-border rounded-lg text-sm focus:outline-none focus:border-muted focus:ring-1 focus:ring-muted"
      />
      {query && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
});

export default MultiSelectFilter;
