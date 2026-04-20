"use client";

import type { ReactNode } from "react";

// ── Container ────────────────────────────────────────────────
export interface AdminFilterBarProps {
  children: ReactNode;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
}

export function AdminFilterBar({ children, onClearAll, hasActiveFilters }: AdminFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-t-border/60 bg-surface p-3">
      {children}
      {hasActiveFilters && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-xs text-muted hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ── DateRangeChip (segmented chip group) ─────────────────────
export interface DateRangeOption<V extends string = string> {
  value: V;
  label: string;
}
export interface DateRangeChipProps<V extends string = string> {
  selected: V;
  options: ReadonlyArray<DateRangeOption<V>>;
  onChange: (value: V) => void;
  label?: string; // optional visible label to the left
}
export function DateRangeChip<V extends string = string>({ selected, options, onChange, label }: DateRangeChipProps<V>) {
  return (
    <div className="flex items-center gap-1">
      {label && <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>}
      <div className="flex rounded-md border border-t-border/60 bg-surface-2 p-0.5">
        {options.map((opt) => {
          const isActive = opt.value === selected;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(opt.value)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                isActive ? "bg-surface-elevated text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Single toggle chip ───────────────────────────────────────
export interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}
export function FilterChip({ active, onClick, children, label }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md border border-t-border/60 px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-surface-elevated text-foreground" : "bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ── Search input ─────────────────────────────────────────────
export interface FilterSearchProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  widthClass?: string;
}
export function FilterSearch({ value, onChange, placeholder, widthClass = "w-56" }: FilterSearchProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-md border border-t-border/60 bg-surface-2 px-3 py-1 text-xs text-foreground placeholder:text-muted ${widthClass}`}
    />
  );
}
