"use client";

import { useCallback, useRef, useEffect } from "react";
import type { IdrItem } from "./IdrMeetingClient";

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

const NOTE_FIELDS: { key: keyof IdrItem; label: string }[] = [
  { key: "customerNotes", label: "Customer Notes" },
  { key: "operationsNotes", label: "Operations Notes" },
  { key: "designNotes", label: "Design Notes" },
  { key: "conclusion", label: "Conclusion" },
];

export function MeetingNotesForm({ item, onChange, readOnly }: Props) {
  const handleChange = useCallback(
    (field: keyof IdrItem, value: string) => {
      onChange({ [field]: value } as Partial<IdrItem>);
    },
    [onChange],
  );

  return (
    <div className="space-y-4">
      {/* Escalation reason (read-only display) */}
      {item.type === "ESCALATION" && item.escalationReason && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-500 mb-1">
            Escalation Reason
          </p>
          <p className="text-sm text-foreground">{item.escalationReason}</p>
        </div>
      )}

      {NOTE_FIELDS.map(({ key, label }) => (
        <AutoResizeTextarea
          key={key}
          label={label}
          value={(item[key] as string | null) ?? ""}
          onChange={(val) => handleChange(key, val)}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-resize textarea
// ---------------------------------------------------------------------------

function AutoResizeTextarea({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
        {label}
      </label>
      <textarea
        ref={ref}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none disabled:opacity-50 placeholder:text-muted"
        placeholder={readOnly ? "" : `Enter ${label.toLowerCase()}...`}
      />
    </div>
  );
}
