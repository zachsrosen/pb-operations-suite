"use client";

interface CommsBulkBarProps {
  selectedCount: number;
  totalCount: number;
  onMarkRead: () => void;
  onArchive: () => void;
  onStar: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function CommsBulkBar({
  selectedCount,
  totalCount,
  onMarkRead,
  onArchive,
  onStar,
  onSelectAll,
  onDeselectAll,
}: CommsBulkBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-30 flex items-center gap-3 rounded-xl bg-foreground/95 backdrop-blur px-4 py-2.5 mb-2 shadow-xl animate-in slide-in-from-top-2">
      <span className="text-sm font-bold text-background">
        {selectedCount} selected
      </span>

      <div className="flex items-center gap-1.5">
        <button
          onClick={onMarkRead}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          Mark Read
        </button>
        <button
          onClick={onArchive}
          className="rounded-lg bg-surface-2/30 px-3 py-1.5 text-xs font-semibold text-background/80 hover:bg-surface-2/50 transition-colors"
        >
          Archive
        </button>
        <button
          onClick={onStar}
          className="rounded-lg bg-amber-600/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
        >
          Star
        </button>
      </div>

      <div className="flex-1" />

      <button
        onClick={selectedCount < totalCount ? onSelectAll : onDeselectAll}
        className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-background/70 hover:bg-white/25 transition-colors"
      >
        {selectedCount < totalCount ? "Select All" : "Deselect All"}
      </button>
      <button
        onClick={onDeselectAll}
        className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-background/70 hover:bg-white/25 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
