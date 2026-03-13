"use client";
import { useState, useCallback } from "react";

export interface ExtractedProduct {
  category?: string;
  brand?: string;
  model?: string;
  description?: string;
  unitSpec?: string;
  unitLabel?: string;
  specValues?: Record<string, unknown>;
  fieldCount?: number;
  totalFields?: number;
}

interface DatasheetImportProps {
  onExtracted: (product: ExtractedProduct) => void;
  onCancel: () => void;
}

export default function DatasheetImport({ onExtracted, onCancel }: DatasheetImportProps) {
  const [mode, setMode] = useState<"choose" | "paste">("choose");
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const extract = useCallback(async (body: FormData | { text: string }) => {
    setLoading(true);
    setError(null);
    try {
      const isFormData = body instanceof FormData;
      const res = await fetch("/api/catalog/extract-from-datasheet", {
        method: "POST",
        ...(isFormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Extraction failed" }));
        throw new Error(err.error || "Extraction failed");
      }
      const data: ExtractedProduct = await res.json();
      onExtracted(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed. Try pasting specs as text instead.");
    } finally {
      setLoading(false);
    }
  }, [onExtracted]);

  function handleFile(file: File) {
    if (!file.name.endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10MB.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    extract(fd);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted">Extracting product details...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Import from Datasheet</h3>
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-foreground">
          Cancel
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {mode === "choose" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* PDF Upload */}
          <label
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
              dragOver
                ? "border-cyan-500 bg-cyan-500/10"
                : "border-t-border hover:border-cyan-500/50 hover:bg-surface-2"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <svg className="w-8 h-8 text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-sm font-medium text-foreground">Upload PDF</span>
            <span className="text-xs text-muted mt-1">Drag & drop or click to browse</span>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>

          {/* Paste Text */}
          <button
            type="button"
            onClick={() => setMode("paste")}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-t-border p-8 hover:border-cyan-500/50 hover:bg-surface-2 transition-colors"
          >
            <svg className="w-8 h-8 text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-foreground">Paste Specs</span>
            <span className="text-xs text-muted mt-1">From a website or datasheet</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste product specifications here..."
            rows={8}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="px-4 py-2 text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pasteText.trim().length < 10}
              onClick={() => extract({ text: pasteText.trim() })}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Extract Fields
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
