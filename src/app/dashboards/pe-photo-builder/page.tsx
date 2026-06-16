"use client";

import React, { useState, useRef, useCallback, useEffect, useId } from "react";
import { upload } from "@vercel/blob/client";
import DashboardShell from "@/components/DashboardShell";
import { PhotoChip } from "@/components/pe-builder/PhotoChip";
import { CoverageReport } from "@/components/pe-builder/CoverageReport";
import type { CoverageReport as CoverageReportType } from "@/lib/pe-photo-coverage";
import { PE_M1_CHECKLIST } from "@/lib/pe-photo-shots";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface UploadedFile {
  clientId: string;
  file: File;
  objectUrl: string;
  blobUrl?: string;
  uploading: boolean;
  uploadError?: string;
}

interface TriagePhoto {
  clientId: string;
  name: string;
  shot: string | null;
  verdict: "pass" | "fail" | "needs_review";
  issues: string[];
  equipmentVisible: string[];
}

interface TriageResponse {
  systemType: string;
  soFound: boolean;
  coverage: CoverageReportType;
  photos: TriagePhoto[];
}

interface Candidate {
  id: string;
  address: string;
  dealName: string;
}

/* ------------------------------------------------------------------ */
/*  Shot options derived from PE_M1_CHECKLIST                          */
/* ------------------------------------------------------------------ */

const PE_SHOT_OPTIONS = PE_M1_CHECKLIST
  .filter((item) => item.isPhoto)
  .map((item) => ({
    id: item.id,
    label: item.pePhotoNumber != null ? `${item.pePhotoNumber}. ${item.label}` : item.label,
  }));

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const MAX_PHOTOS = 60;

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function PePhotoBuilderPage() {
  const dropzoneId = useId();

  // Inputs
  const [code, setCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Uploaded files
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [countCapWarning, setCountCapWarning] = useState<string | null>(null);

  // Track every object URL we create so we can revoke them on unmount even
  // if the component never re-renders (fixes the stale-closure leak).
  const objectUrlsRef = useRef<string[]>([]);

  // Triage
  const [triage, setTriage] = useState<TriageResponse | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string | null>>({});
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  // Assemble
  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Revoke all tracked object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  /* ---- Upload a single file to Blob ---- */
  const uploadFile = useCallback(async (entry: UploadedFile, dealCode: string) => {
    try {
      const res = await upload(
        `pe-photo-package/${dealCode}/${entry.clientId}-${entry.file.name}`,
        entry.file,
        {
          access: "public",
          handleUploadUrl: "/api/pe/photo-package/upload-token",
        },
      );
      setFiles((prev) =>
        prev.map((f) =>
          f.clientId === entry.clientId
            ? { ...f, blobUrl: res.url, uploading: false }
            : f,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setFiles((prev) =>
        prev.map((f) =>
          f.clientId === entry.clientId
            ? { ...f, uploading: false, uploadError: msg }
            : f,
        ),
      );
    }
  }, []);

  /* ---- Handle file additions ---- */
  const handleFilesAdded = useCallback(
    (incoming: File[]) => {
      if (!code.trim()) return;

      const existing = files.length;
      const available = MAX_PHOTOS - existing;
      const accepted = incoming.slice(0, available);
      const dropped = incoming.length - accepted.length;

      if (dropped > 0) {
        setCountCapWarning(
          `${dropped} file${dropped > 1 ? "s" : ""} ignored — limit is ${MAX_PHOTOS} photos (${existing} already queued).`,
        );
      } else {
        setCountCapWarning(null);
      }

      if (!accepted.length) return;

      const newEntries: UploadedFile[] = accepted.map((file) => {
        const objectUrl = URL.createObjectURL(file);
        objectUrlsRef.current.push(objectUrl);
        return {
          clientId: crypto.randomUUID(),
          file,
          objectUrl,
          uploading: true,
        };
      });

      setFiles((prev) => [...prev, ...newEntries]);

      const currentCode = code.trim();
      for (const entry of newEntries) {
        void uploadFile(entry, currentCode);
      }
    },
    [code, files.length, uploadFile],
  );

  /* ---- Drag-and-drop handlers ---- */
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dropped = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      handleFilesAdded(dropped);
    },
    [handleFilesAdded],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  /* ---- File input change ---- */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      handleFilesAdded(selected);
      e.target.value = "";
    },
    [handleFilesAdded],
  );

  /* ---- Remove a file ---- */
  const handleRemove = useCallback((clientId: string) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.clientId === clientId);
      if (entry) {
        URL.revokeObjectURL(entry.objectUrl);
        objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== entry.objectUrl);
      }
      return prev.filter((f) => f.clientId !== clientId);
    });
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[clientId];
      return next;
    });
  }, []);

  /* ---- Re-tag a photo ---- */
  const handleRetag = useCallback((clientId: string, shotId: string | null) => {
    if (shotId === null) {
      handleRemove(clientId);
    } else {
      setAssignments((prev) => ({ ...prev, [clientId]: shotId }));
    }
  }, [handleRemove]);

  /* ---- Triage ---- */
  const anyUploading = files.some((f) => f.uploading);
  const readyForTriage = code.trim().length > 0 && files.length > 0 && !anyUploading;

  const handleTriage = useCallback(async () => {
    const uploadedPhotos = files.filter((f) => f.blobUrl);
    if (!uploadedPhotos.length) return;

    setTriageLoading(true);
    setTriageError(null);
    setCandidates([]);

    try {
      const res = await fetch("/api/pe/photo-package/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          photos: uploadedPhotos.map((f) => ({
            clientId: f.clientId,
            name: f.file.name,
            blobUrl: f.blobUrl,
          })),
        }),
      });

      if (res.status === 404) {
        setTriageError("PE project code not found — double-check the code.");
        return;
      }

      if (res.status === 400) {
        const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        setTriageError(`Check your input: ${data.error ?? "invalid request"}`);
        return;
      }

      if (res.status === 409) {
        const data = (await res.json()) as { error: string; candidates?: Candidate[] };
        setCandidates(data.candidates ?? []);
        setTriageError("Multiple deals matched this PE code.");
        return;
      }

      if (res.status === 502) {
        setTriageError("Vision service is busy — please try again in a moment.");
        return;
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        setTriageError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      const data = (await res.json()) as TriageResponse;
      setTriage(data);

      const seeded: Record<string, string | null> = {};
      for (const photo of data.photos) {
        seeded[photo.clientId] = photo.shot;
      }
      setAssignments(seeded);
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : "Triage request failed");
    } finally {
      setTriageLoading(false);
    }
  }, [code, files]);

  /* ---- Build PDF ---- */
  const handleBuildPdf = useCallback(async () => {
    setAssembling(true);
    setAssembleError(null);
    setWarnings([]);

    try {
      const res = await fetch("/api/pe/photo-package/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          assignments: files
            .filter((f) => f.blobUrl)
            .map((f) => ({
              clientId: f.clientId,
              blobUrl: f.blobUrl,
              shotId: assignments[f.clientId] ?? null,
            })),
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { error?: string };
        setAssembleError(data.error ?? `Assemble failed (${res.status})`);
        return;
      }

      const rawWarnings = res.headers.get("x-pe-warnings");
      if (rawWarnings) {
        try {
          const parsed = JSON.parse(rawWarnings) as string[];
          if (Array.isArray(parsed)) setWarnings(parsed);
        } catch {
          // ignore parse errors
        }
      }

      let filename = "pe-photos.pdf";
      const cd = res.headers.get("content-disposition");
      if (cd) {
        const match = /filename="([^"]+)"/.exec(cd);
        if (match?.[1]) filename = match[1];
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : "Assemble request failed");
    } finally {
      setAssembling(false);
    }
  }, [code, files, assignments]);

  /* ---- Shot options for chips ---- */
  const shotOptions = triage
    ? [
        ...PE_SHOT_OPTIONS,
        ...triage.coverage.bonus
          .filter((b) => !PE_SHOT_OPTIONS.some((o) => o.id === b.id))
          .map((b) => ({
            id: b.id,
            label: b.pePhotoNumber != null ? `${b.pePhotoNumber}. ${b.label}` : b.label,
          })),
      ]
    : PE_SHOT_OPTIONS;

  const gridFiles = files.filter((f) => f.objectUrl);

  return (
    <DashboardShell title="PE Photo Builder" accentColor="emerald" fullWidth>
      <div className="space-y-6 pb-10">

        {/* Step 1: Code + Dropzone */}
        <div className="bg-surface border border-t-border rounded-xl shadow-card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            1. Enter PE Project Code &amp; Upload Photos
          </h2>

          <div className="flex items-center gap-3 flex-wrap">
            <label htmlFor="pe-code" className="text-sm text-muted shrink-0">
              PE code, PROJ number, or customer name
            </label>
            <input
              id="pe-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. CO1234-ABC1 · PROJ-789 · Smith"
              className="rounded-lg border border-t-border bg-surface-2 text-foreground text-sm px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {!code.trim() && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Enter a PE code, PROJ number, or customer name before uploading photos.
              </span>
            )}
          </div>

          {/* Dropzone */}
          <div
            id={dropzoneId}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => code.trim() && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) fileInputRef.current?.click(); }}
            aria-label="Drop photos here or click to browse"
            className={[
              "border-2 border-dashed rounded-xl p-8 text-center transition-colors select-none",
              code.trim()
                ? "border-emerald-400 dark:border-emerald-600 cursor-pointer hover:bg-surface-2"
                : "border-t-border cursor-not-allowed opacity-50",
            ].join(" ")}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
              disabled={!code.trim()}
            />
            <p className="text-sm text-muted">
              Drag &amp; drop photos here, or{" "}
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                click to browse
              </span>
            </p>
            <p className="text-xs text-muted mt-1">
              Up to {MAX_PHOTOS} photos &mdash; JPEG, PNG
            </p>
          </div>

          {countCapWarning && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {countCapWarning}
            </p>
          )}

          {files.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
              <span>{files.length} photo{files.length !== 1 ? "s" : ""} queued</span>
              {anyUploading && (
                <span className="text-emerald-600 dark:text-emerald-400 animate-pulse">
                  Uploading&hellip;
                </span>
              )}
              {!anyUploading && files.some((f) => f.blobUrl) && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  All uploaded
                </span>
              )}
              {files.some((f) => f.uploadError) && (
                <span className="text-red-600 dark:text-red-400">
                  {files.filter((f) => f.uploadError).length} upload error(s)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Triage */}
        <div className="bg-surface border border-t-border rounded-xl shadow-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-sm font-semibold text-foreground">
              2. Check Coverage
            </h2>
            <button
              type="button"
              onClick={() => void handleTriage()}
              disabled={!readyForTriage || triageLoading}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {triageLoading ? "Checking…" : "Check coverage"}
            </button>
          </div>

          {triageError && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 space-y-2">
              <p className="font-medium">{triageError}</p>
              {candidates.length > 0 && (
                <div>
                  <p className="text-xs text-red-600 dark:text-red-400 mb-1">
                    Multiple deals matched &mdash; be more specific (add address, PROJ number, or PE code):
                  </p>
                  <ul className="space-y-1">
                    {candidates.map((c) => (
                      <li key={c.id} className="text-xs text-red-700 dark:text-red-300">
                        <span className="font-medium">{c.dealName}</span>
                        {c.address && (
                          <span className="text-red-600 dark:text-red-400 ml-1">&mdash; {c.address}</span>
                        )}
                        <span className="ml-1 text-red-400 dark:text-red-500">({c.id})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {triage && (
            <CoverageReport coverage={triage.coverage} />
          )}
        </div>

        {/* Photo Grid */}
        {gridFiles.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground px-1">
              Photos ({gridFiles.length})
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 stagger-grid">
              {gridFiles.map((f) => {
                const triagePhoto = triage?.photos.find((p) => p.clientId === f.clientId) ?? {
                  clientId: f.clientId,
                  name: f.file.name,
                  shot: null,
                  verdict: "needs_review" as const,
                  issues: f.uploading
                    ? ["Uploading…"]
                    : f.uploadError
                    ? [f.uploadError]
                    : ["Not yet triaged"],
                  equipmentVisible: [],
                };

                return (
                  <PhotoChip
                    key={f.clientId}
                    photo={triagePhoto}
                    objectUrl={f.objectUrl}
                    shotOptions={shotOptions}
                    currentShotId={assignments[f.clientId] ?? null}
                    onRetag={handleRetag}
                    onRemove={handleRemove}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Build PDF */}
        {triage && (
          <div className="bg-surface border border-t-border rounded-xl shadow-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-sm font-semibold text-foreground">
                3. Build PDF
              </h2>
              <button
                type="button"
                onClick={() => void handleBuildPdf()}
                disabled={assembling}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                {assembling ? "Building…" : "Build PDF"}
              </button>
            </div>

            <p className="text-xs text-muted">
              Photos tagged as &ldquo;Not a PE shot&rdquo; are excluded. Photos are ordered by canonical PE shot
              sequence and the Sales Order is inserted at position 6.
            </p>

            {assembleError && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {assembleError}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Warnings ({warnings.length})
                </p>
                <ul className="space-y-0.5">
                  {warnings.map((w, i) => (
                    <li key={w + i} className="text-xs text-amber-700 dark:text-amber-300">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

      </div>
    </DashboardShell>
  );
}
