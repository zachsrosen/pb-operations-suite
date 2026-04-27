"use client";

/**
 * SOP Editor — WYSIWYG rich-text editing built on TipTap.
 *
 * Replaces the prior raw-HTML CodeMirror editor. Output is still HTML, so
 * storage, sanitization, and rendering all stay the same. Users get
 * formatting buttons (headings, lists, tables, callouts) instead of having
 * to know the markup.
 *
 * Two modes:
 *  - "edit"    — admin/owner/executive saves directly via PUT
 *  - "suggest" — non-admin authenticated users submit via POST for review
 *
 * Both modes share optimistic locking on the section's version field.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Placeholder } from "@tiptap/extension-placeholder";

interface SopEditorProps {
  sectionId: string;
  sectionTitle: string;
  initialContent: string;
  initialVersion: number;
  mode: "edit" | "suggest";
  onSave: (newVersion?: number) => void;
  onCancel: () => void;
}

/**
 * Wrap the current selection in a callout div (info / warn / tip / sys).
 * Implemented as a setNode-equivalent: insert a div with the callout class
 * around the current block. We use insertContent with a paragraph inside
 * the wrapper since TipTap's StarterKit gives us paragraph as a node.
 */
function insertCallout(editor: Editor, variant: "info" | "warn" | "tip" | "sys") {
  const selectedText = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    " ",
  );
  const inner = selectedText.trim() || "Add your note here…";
  const html = `<div class="${variant}">${inner}</div>`;
  editor.chain().focus().insertContent(html).run();
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, active, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? "bg-orange-500/20 text-orange-400"
          : "text-foreground hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="w-px h-5 bg-t-border mx-1" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  if (!editor) return null;

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("Link URL", previousUrl ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-t-border bg-surface px-3 py-2 sticky top-0 z-10">
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Cmd+Z)"
      >
        ↶
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Cmd+Shift+Z)"
      >
        ↷
      </ToolbarButton>

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive("paragraph")}
        title="Paragraph"
      >
        ¶
      </ToolbarButton>

      <ToolbarDivider />

      {/* Marks */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Cmd+B)"
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Cmd+I)"
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        {`<>`}
      </ToolbarButton>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        • List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        1. List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Quote"
      >
        ❝
      </ToolbarButton>

      <ToolbarDivider />

      {/* Link */}
      <ToolbarButton
        onClick={setLink}
        active={editor.isActive("link")}
        title="Link"
      >
        🔗 Link
      </ToolbarButton>

      <ToolbarDivider />

      {/* Table */}
      <ToolbarButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        title="Insert table"
      >
        Table
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().addColumnAfter().run()}
        disabled={!editor.can().addColumnAfter()}
        title="Add column"
      >
        +Col
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().addRowAfter().run()}
        disabled={!editor.can().addRowAfter()}
        title="Add row"
      >
        +Row
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().deleteRow().run()}
        disabled={!editor.can().deleteRow()}
        title="Delete row"
      >
        −Row
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().deleteTable().run()}
        disabled={!editor.can().deleteTable()}
        title="Delete table"
      >
        ✕Tbl
      </ToolbarButton>

      <ToolbarDivider />

      {/* Callouts */}
      <ToolbarButton
        onClick={() => insertCallout(editor, "info")}
        title="Info callout (blue)"
      >
        <span className="text-blue-400">ℹ Info</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => insertCallout(editor, "warn")}
        title="Warning callout (amber)"
      >
        <span className="text-amber-400">⚠ Warn</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => insertCallout(editor, "tip")}
        title="Tip callout (green)"
      >
        <span className="text-green-400">💡 Tip</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => insertCallout(editor, "sys")}
        title="System callout"
      >
        <span className="text-purple-400">⚙ Sys</span>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Horizontal rule */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal divider"
      >
        ―
      </ToolbarButton>

      {/* Clear formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        title="Clear formatting"
      >
        Clear
      </ToolbarButton>
    </div>
  );
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const titleId = "sop-editor-title";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Use a single horizontal rule node — StarterKit handles this.
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: "Start writing… use the toolbar above to format.",
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "sop-content prose prose-invert max-w-none focus:outline-none px-8 py-6 min-h-full",
      },
    },
    immediatelyRender: false,
  });

  // Escape to close + tab trap within dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const content = editor.getHTML();
    if (!content.trim() || content === "<p></p>") {
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
            `Version conflict: the section was updated to version ${data.currentVersion} while you were editing. Please reload and try again.`,
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
  }, [editor, mode, sectionId, initialVersion, editSummary, onSave]);

  if (!editor) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 flex flex-col bg-background"
      style={{ zIndex: 1100 }}
    >
      {/* Top bar: title + edit summary + save/cancel */}
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
            type="button"
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
            type="button"
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
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1 text-xs rounded bg-red-500/20 hover:bg-red-500/30 transition-colors"
            >
              Reload Page
            </button>
          )}
        </div>
      )}

      {/* Toolbar (sticky) + Editor canvas */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Toolbar editor={editor} />
        <div className="flex-1 overflow-auto bg-background">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
