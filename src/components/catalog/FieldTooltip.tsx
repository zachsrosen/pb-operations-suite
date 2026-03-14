"use client";
import { useState } from "react";

interface FieldTooltipProps {
  text: string;
}

export default function FieldTooltip({ text }: FieldTooltipProps) {
  const [show, setShow] = useState(false);

  return (
    <span className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="w-4 h-4 rounded-full bg-surface-2 text-muted text-[10px] font-bold inline-flex items-center justify-center hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors"
        aria-label="Field help"
      >
        ?
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-surface-elevated border border-t-border p-2.5 text-xs text-foreground shadow-lg">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-surface-elevated" />
        </div>
      )}
    </span>
  );
}
