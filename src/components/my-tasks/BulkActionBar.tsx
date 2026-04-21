"use client";

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  onMarkAllDone: () => void;
  working: boolean;
}

export default function BulkActionBar({ count, onClear, onMarkAllDone, working }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm backdrop-blur-sm">
      <span className="font-medium text-foreground">
        {count} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-muted hover:text-foreground"
      >
        Clear
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onMarkAllDone}
          disabled={working}
          className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
        >
          {working ? "Marking done…" : `✓ Mark ${count} done`}
        </button>
      </div>
    </div>
  );
}
