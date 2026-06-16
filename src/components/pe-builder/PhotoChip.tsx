"use client";

interface ShotOption {
  id: string;
  label: string;
}

interface PhotoChipPhoto {
  clientId: string;
  name: string;
  shot: string | null;
  verdict: "pass" | "fail" | "needs_review";
  issues: string[];
}

interface PhotoChipProps {
  photo: PhotoChipPhoto;
  objectUrl: string;
  shotOptions: ShotOption[];
  currentShotId: string | null;
  onRetag: (clientId: string, shotId: string | null) => void;
  onRemove: (clientId: string) => void;
}

const VERDICT_STYLES: Record<PhotoChipPhoto["verdict"], { dot: string; label: string; text: string }> = {
  pass: {
    dot: "bg-emerald-500",
    label: "Pass",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  needs_review: {
    dot: "bg-amber-500",
    label: "Review",
    text: "text-amber-600 dark:text-amber-400",
  },
  fail: {
    dot: "bg-red-500",
    label: "Fail",
    text: "text-red-600 dark:text-red-400",
  },
};

export function PhotoChip({ photo, objectUrl, shotOptions, currentShotId, onRetag, onRemove }: PhotoChipProps) {
  const verdict = VERDICT_STYLES[photo.verdict];
  const truncatedName = photo.name.length > 28 ? `${photo.name.slice(0, 25)}…` : photo.name;

  return (
    <div className="bg-surface border border-t-border rounded-xl shadow-card overflow-hidden flex flex-col">
      {/* Thumbnail */}
      <div className="relative w-full h-36 bg-surface-2 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          alt={photo.name}
          className="w-full h-full object-cover"
        />
        {/* Verdict dot overlay */}
        <span
          className={`absolute top-2 right-2 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 ${verdict.dot}`}
          title={verdict.label}
        />
        {/* Remove button overlay */}
        <button
          type="button"
          onClick={() => onRemove(photo.clientId)}
          className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center text-xs leading-none transition-colors"
          title="Remove photo"
          aria-label="Remove photo"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="p-2.5 flex flex-col gap-1.5 flex-1">
        {/* File name + verdict */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-foreground truncate flex-1" title={photo.name}>
            {truncatedName}
          </span>
          <span className={`text-[10px] font-semibold shrink-0 ${verdict.text}`}>
            {verdict.label}
          </span>
        </div>

        {/* Issues */}
        {photo.issues.length > 0 && (
          <ul className="space-y-0.5">
            {photo.issues.map((issue, i) => (
              <li key={i} className="text-[10px] text-muted leading-tight">
                {issue}
              </li>
            ))}
          </ul>
        )}

        {/* Shot re-tag select */}
        <select
          value={currentShotId ?? ""}
          onChange={(e) => onRetag(photo.clientId, e.target.value || null)}
          className="mt-auto w-full text-[11px] rounded bg-surface-2 border border-t-border text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          aria-label="Assign shot"
        >
          <option value="">Not a PE shot (drop)</option>
          {shotOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
