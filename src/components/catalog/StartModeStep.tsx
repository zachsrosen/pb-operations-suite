"use client";
import { useState } from "react";
import CloneSearch from "./CloneSearch";
import DatasheetImport from "./DatasheetImport";

type StartMode = "choose" | "clone" | "datasheet";

interface StartModeStepProps {
  onStartScratch: () => void;
  onClone: (product: Record<string, unknown>) => void;
  onDatasheetExtracted: (product: Record<string, unknown>) => void;
}

export default function StartModeStep({
  onStartScratch,
  onClone,
  onDatasheetExtracted,
}: StartModeStepProps) {
  const [mode, setMode] = useState<StartMode>("choose");

  if (mode === "clone") {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <CloneSearch onSelect={onClone} onCancel={() => setMode("choose")} />
      </div>
    );
  }

  if (mode === "datasheet") {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <DatasheetImport onExtracted={onDatasheetExtracted} onCancel={() => setMode("choose")} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <button
        type="button"
        onClick={onStartScratch}
        className="flex flex-col items-center gap-3 rounded-xl border border-t-border bg-surface p-8 shadow-card hover:border-cyan-500/50 hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground">Start from Scratch</span>
        <span className="text-xs text-muted text-center">Blank form — fill in everything manually</span>
      </button>

      <button
        type="button"
        onClick={() => setMode("clone")}
        className="flex flex-col items-center gap-3 rounded-xl border border-t-border bg-surface p-8 shadow-card hover:border-green-500/50 hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground">Clone Existing Product</span>
        <span className="text-xs text-muted text-center">Copy from an existing catalog item</span>
      </button>

      <button
        type="button"
        onClick={() => setMode("datasheet")}
        className="flex flex-col items-center gap-3 rounded-xl border border-t-border bg-surface p-8 shadow-card hover:border-purple-500/50 hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground">Import from Datasheet</span>
        <span className="text-xs text-muted text-center">Upload PDF or paste specs — AI fills the form</span>
      </button>
    </div>
  );
}
