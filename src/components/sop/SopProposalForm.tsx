"use client";

/**
 * SOP Proposal Form — Submit a brand-new SOP for inclusion in the guide.
 *
 * Distinct from SopEditor's "suggest" mode (which suggests EDITS to an
 * existing section). This form proposes a NEW section: title, target
 * tab, content body, and a "why this matters" note.
 *
 * Available to any authenticated non-VIEWER user. Submissions land in
 * the SopProposal table for admin review at /dashboards/admin/sop-proposals.
 */

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Placeholder } from "@tiptap/extension-placeholder";

interface SopTabOption {
  id: string;
  label: string;
}

interface SopProposalFormProps {
  /** Tabs the submitter can choose from. Fetched from /api/sop/tabs by parent. */
  tabs: SopTabOption[];
  /** Default suggested tab — usually the tab the user is currently viewing. */
  defaultTabId?: string;
  onSubmitted: (proposalId: string) => void;
  onCancel: () => void;
}

// ------- Toolbar -----------------------------------------------------------

function insertCallout(editor: Editor, variant: "info" | "warn" | "tip" | "sys") {
  const selectedText = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    " ",
  );
  const inner = selectedText.trim() || "Add your note here…";
  editor.chain().focus().insertContent(`<div class="${variant}">${inner}</div>`).run();
}

interface TBProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function TB({ onClick, active, disabled, title, children }: TBProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? "bg-orange-500/20 text-orange-400" : "text-foreground hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-t-border mx-1" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("Link URL", previousUrl ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-t-border bg-surface px-3 py-2 sticky top-0 z-10">
      <TB onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">↶</TB>
      <TB onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">↷</TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1">H1</TB>
      <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">H2</TB>
      <TB onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">H3</TB>
      <TB onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive("paragraph")} title="Paragraph">¶</TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><strong>B</strong></TB>
      <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><em>I</em></TB>
      <TB onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><s>S</s></TB>
      <TB onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">{`<>`}</TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">• List</TB>
      <TB onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">1. List</TB>
      <TB onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">❝</TB>
      <Divider />
      <TB onClick={setLink} active={editor.isActive("link")} title="Link">🔗 Link</TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">Table</TB>
      <TB onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.can().addColumnAfter()} title="Add column">+Col</TB>
      <TB onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!editor.can().addRowAfter()} title="Add row">+Row</TB>
      <TB onClick={() => editor.chain().focus().deleteRow().run()} disabled={!editor.can().deleteRow()} title="Delete row">−Row</TB>
      <TB onClick={() => editor.chain().focus().deleteTable().run()} disabled={!editor.can().deleteTable()} title="Delete table">✕Tbl</TB>
      <Divider />
      <TB onClick={() => insertCallout(editor, "info")} title="Info callout"><span className="text-blue-400">ℹ Info</span></TB>
      <TB onClick={() => insertCallout(editor, "warn")} title="Warning callout"><span className="text-amber-400">⚠ Warn</span></TB>
      <TB onClick={() => insertCallout(editor, "tip")} title="Tip callout"><span className="text-green-400">💡 Tip</span></TB>
      <TB onClick={() => insertCallout(editor, "sys")} title="System callout"><span className="text-purple-400">⚙ Sys</span></TB>
      <Divider />
      <TB onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">―</TB>
      <TB onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting">Clear</TB>
    </div>
  );
}

// ------- Form --------------------------------------------------------------

export default function SopProposalForm({
  tabs,
  defaultTabId,
  onSubmitted,
  onCancel,
}: SopProposalFormProps) {
  const [title, setTitle] = useState("");
  const [tabId, setTabId] = useState(defaultTabId ?? tabs[0]?.id ?? "");
  const [group, setGroup] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
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
        placeholder:
          "Write the SOP content here. Use the toolbar to format — headings, tables, callouts. Don't worry about including the title; it's set in the field above.",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "sop-content prose prose-invert max-w-none focus:outline-none px-8 py-6 min-h-full",
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onCancel]);

  const handleSubmit = useCallback(async () => {
    if (!editor) return;
    const content = editor.getHTML();

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!tabId) {
      setError("Pick a target tab");
      return;
    }
    if (!content.trim() || content === "<p></p>") {
      setError("Add some content for the SOP");
      return;
    }
    if (!reason.trim()) {
      setError("Tell us why this SOP matters (one or two sentences)");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/sop/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          suggestedTabId: tabId,
          suggestedGroup: group.trim() || undefined,
          content,
          reason: reason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Submit failed");
        return;
      }
      onSubmitted(data.proposalId);
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  }, [editor, title, tabId, group, reason, onSubmitted]);

  if (!editor) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-title"
      className="fixed inset-0 flex flex-col bg-background"
      style={{ zIndex: 1100 }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-t-border px-4 py-2 bg-surface">
        <div className="flex items-center gap-3">
          <h3 id="proposal-title" className="text-sm font-semibold text-foreground">
            Submit a New SOP
          </h3>
          <span className="text-xs px-2 py-0.5 rounded bg-surface-2 text-muted">
            For admin review
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-1.5 text-sm font-medium rounded bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Submitting..." : "Submit Proposal"}
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
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Form fields */}
      <div className="border-b border-t-border bg-surface px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-5">
          <label className="block text-xs text-muted mb-1">Title <span className="text-red-400">*</span></label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. How to handle a stuck Xcel interconnection RFI"
            maxLength={200}
            className="w-full px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs text-muted mb-1">Target tab <span className="text-red-400">*</span></label>
          <select
            value={tabId}
            onChange={(e) => setTabId(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground focus:outline-none focus:ring-1 focus:ring-orange-500"
          >
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-4">
          <label className="block text-xs text-muted mb-1">
            Sidebar group (optional)
            <span className="text-muted/70 ml-1">— leave blank to let admin decide</span>
          </label>
          <input
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="e.g. Daily Workflow"
            className="w-full px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
        <div className="md:col-span-12">
          <label className="block text-xs text-muted mb-1">
            Why this SOP matters <span className="text-red-400">*</span>
            <span className="text-muted/70 ml-1">— what gap does it fill?</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="One or two sentences. The admin reviewer reads this first."
            rows={2}
            maxLength={2000}
            className="w-full px-3 py-1.5 text-sm rounded bg-surface-2 border border-t-border text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
      </div>

      {/* Editor + Toolbar */}
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
