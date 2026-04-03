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
    <div className="space-y-2">
      {/* Escalation reason (read-only display) */}
      {item.type === "ESCALATION" && item.escalationReason && (
        <div className="rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 mb-0.5">
            Escalation Reason
          </p>
          <p className="text-xs text-foreground">{item.escalationReason}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
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
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted block mb-0.5">
        {label}
      </label>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        className="w-full rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground resize-none disabled:opacity-50 placeholder:text-muted"
        placeholder={readOnly ? "" : `${label.toLowerCase()}...`}
      />
    </div>
  );
}
