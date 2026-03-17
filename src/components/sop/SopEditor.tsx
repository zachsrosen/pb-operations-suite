"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { sanitizeSopContent } from "@/lib/sop-sanitize";

// CodeMirror imports — dynamic import ensures no SSR
import { EditorView, basicSetup } from "codemirror";
import { html } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";

interface SopEditorProps {
  sectionId: string;
  sectionTitle: string;
  initialContent: string;
  initialVersion: number;
  mode: "edit" | "suggest";
  onSave: (newVersion?: number) => void;
  onCancel: () => void;
}

export default function SopEditor({
  sectionId,
  sectionTitle,
  initialContent,
  initialVersion,
  mode,
  onSave,
  onCancel,
}: SopEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [preview, setPreview] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = "sop-editor-title";

  // Debounced preview update (300ms delay to avoid lag on large payloads)
  const updatePreview = useCallback((content: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreview(sanitizeSopContent(content));
    }, 300);
  }, []);

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updatePreview(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    // Initial preview
    setPreview(sanitizeSopContent(initialContent));

    // Focus the editor surface on mount
    requestAnimationFrame(() => view.focus());

    return () => {
      view.destroy();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [initialContent, updatePreview]);

  // Escape key to close; Tab trap within dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), .cm-content'
          )
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const getContent = useCallback(() => {
    return viewRef.current?.state.doc.toString() || "";
  }, []);

  const handleSave = useCallback(async () => {
    const content = getContent();
    if (!content.trim()) {
      setError("Content cannot be empty");
      return;
    }

    if (mode === "suggest" && !editSummary.trim()) {
      setError("Please provide a summary of your changes");
      return;
    }

    setSaving(true);
    setError(null);
    setConflictVersion(null);

    try {
      const url =
        mode === "edit"
          ? `/api/admin/sop/sections/${sectionId}`
          : `/api/sop/sections/${sectionId}/suggest`;

      const method = mode === "edit" ? "PUT" : "POST";
      const body =
        mode === "edit"
          ? { content, version: initialVersion, editSummary: editSummary || undefined }
          : { content, summary: editSummary };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.currentVersion) {
          setConflictVersion(data.currentVersion);
          setError(
            `Version conflict: the section was updated to version ${data.currentVersion} while you were editing. Please reload and try again.`
          );
        } else {
          setError(data.error || "Save failed");
        }
        return;
      }

      onSave(data.version);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }, [getContent, mode, sectionId, initialVersion, editSummary, onSave]);

  // Preview HTML is already sanitized via sanitizeSopContent() — safe for rendering.
  // The sanitizer (sop-sanitize.ts) strips scripts, event handlers, dangerous URIs,
  // and filters CSS values through SAFE_STYLE_RE + DANGEROUS_VALUE_RE denylists.
  const previewHtml = useMemo(() => preview, [preview]);

  // Portal to document.body so the fixed overlay escapes any parent stacking context
  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 flex flex-col bg-background"
      style={{ zIndex: 1100 }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-t-border px-4 py-2 bg-surface">
        <div className="flex items-center gap-3">
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            {mode === "edit" ? "Edit" : "Suggest Change"}: {sectionTitle}
          </h3>
          <span className="text-xs px-2 py-0.5 rounded bg-surface-2 text-muted">
            {mode === "edit" ? "Direct Edit" : "Suggestion Mode"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={
              mode === "edit"
                ? "Edit summary (optional)"
                : "Describe your changes (required)"
            }
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            className="w-64 px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving
              ? "Saving..."
              : mode === "edit"
                ? "Save"
                : "Submit Suggestion"}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm font-medium rounded bg-surface-2 text-foreground hover:bg-surface border border-t-border transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          {conflictVersion && (
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1 text-xs rounded bg-red-500/20 hover:bg-red-500/30 transition-colors"
            >
              Reload Page
            </button>
          )}
        </div>
      )}

      {/* Split pane: Editor + Preview */}
      <div className="flex-1 flex min-h-0">
        {/* Left: CodeMirror editor */}
        <div className="w-1/2 border-r border-t-border overflow-hidden">
          <div ref={editorRef} className="h-full" />
        </div>

        {/* Right: Live preview */}
        <div className="w-1/2 overflow-auto p-6 bg-surface">
          <div className="text-xs text-muted mb-3 uppercase tracking-wider font-medium">
            Live Preview
          </div>
          {/* Content is sanitized through sanitizeSopContent() before rendering */}
          <div
            className="sop-content prose prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
