"use client";

import { useRef, useState } from "react";

export type TriagePhoto = {
  code: string;
  url: string;
  pathname?: string;
  fileName?: string;
  uploadedAt: string;
};

type Props = {
  runId: string;
  code: string;
  label?: string;
  value: TriagePhoto | null;
  onChange: (next: TriagePhoto | null) => void;
};

const MAX_DIM = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Compress an image client-side before upload. Reads the user-selected file
 * via FileReader → offscreen Image → canvas, keeping the longest edge at
 * `MAX_DIM` and re-encoding as JPEG at `JPEG_QUALITY`. Returns a new File.
 *
 * If the browser can't decode the image (rare — unsupported HEIC on old
 * iOS webviews), fall back to the original file so the rep isn't blocked.
 */
export async function compressImage(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (window as any).createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close?.();

  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) return file;

  const outName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], outName, { type: "image/jpeg" });
}

export default function TriagePhotoCapture({
  runId,
  code,
  label,
  value,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("file", compressed);
      const upRes = await fetch("/api/triage/upload", {
        method: "POST",
        body: fd,
      });
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : `Upload failed (${upRes.status})`
        );
      }
      const { url, pathname, fileName } = await upRes.json();
      const nextPhoto: TriagePhoto = {
        code,
        url,
        pathname,
        fileName,
        uploadedAt: new Date().toISOString(),
      };

      // Merge into run.photos. We do a read-modify-write PATCH rather than
      // sending just the delta — the backend expects the full array.
      const runRes = await fetch(`/api/triage/runs/${runId}`);
      if (runRes.ok) {
        const { run } = await runRes.json();
        const existing: TriagePhoto[] = Array.isArray(run?.photos)
          ? run.photos
          : [];
        const merged = [
          ...existing.filter((p) => p.code !== code),
          nextPhoto,
        ];
        await fetch(`/api/triage/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: merged }),
        });
      }

      onChange(nextPhoto);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!value) return;
    setBusy(true);
    try {
      await fetch("/api/triage/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value.url }),
      }).catch(() => null);
      // Prune run.photos server-side
      const runRes = await fetch(`/api/triage/runs/${runId}`);
      if (runRes.ok) {
        const { run } = await runRes.json();
        const existing: TriagePhoto[] = Array.isArray(run?.photos)
          ? run.photos
          : [];
        const merged = existing.filter((p) => p.code !== code);
        await fetch(`/api/triage/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: merged }),
        });
      }
      onChange(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          {label}
        </span>
      )}
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-t-border bg-surface p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.url}
            alt={value.fileName ?? "photo"}
            className="h-16 w-16 flex-shrink-0 rounded object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-foreground">
              {value.fileName ?? "Uploaded"}
            </div>
            <div className="text-xs text-muted">Uploaded</div>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-dashed border-t-border bg-surface px-4 py-6 text-sm text-muted transition-colors hover:border-orange-500 hover:text-orange-500 disabled:opacity-60"
          >
            {busy ? "Uploading…" : "Tap to take photo"}
          </button>
        </>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  );
}
