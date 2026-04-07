'use client';

import { useRef, useCallback } from 'react';
import { unzipSync } from 'fflate';
import { parseJSON, parseDXF, parseShadeCSV } from '@/lib/solar/v12-engine';
import type { PanelGeometry, ShadeTimeseries, ShadeFidelity, ShadeSource } from '@/lib/solar/v12-engine';
import type { RadiancePoint } from '@/lib/solar/v12-engine/layout-parser';
import type { SolarDesignerAction, UploadedFile } from './types';

interface FileUploadPanelProps {
  uploadedFiles: UploadedFile[];
  panelCount: number;
  radiancePointCount: number;
  isUploading: boolean;
  uploadError: string | null;
  dispatch: (action: SolarDesignerAction) => void;
}

const ACCEPTED_EXTENSIONS = ['.dxf', '.json', '.csv'];

/** Extract .dxf/.json/.csv files from a zip archive into File objects. */
async function extractFilesFromZip(zipFile: File): Promise<File[]> {
  const buf = await zipFile.arrayBuffer();
  const entries = unzipSync(new Uint8Array(buf));
  const files: File[] = [];
  for (const [path, data] of Object.entries(entries)) {
    // Skip directories and __MACOSX junk
    if (path.endsWith('/') || path.startsWith('__MACOSX')) continue;
    const name = path.split('/').pop() ?? path;
    const ext = '.' + name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) continue;
    files.push(new File([data], name));
  }
  return files;
}

/** Recursively collect files from a dropped directory entry. */
async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries((e) => resolve(e), () => resolve([]));
    });
    const nested = await Promise.all(entries.map(collectFilesFromEntry));
    return nested.flat();
  }
  return [];
}

export default function FileUploadPanel({
  uploadedFiles, panelCount, radiancePointCount, isUploading, uploadError, dispatch,
}: FileUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    // Expand zip archives, then filter to accepted extensions
    const raw = Array.from(fileList);
    const expanded: File[] = [];
    for (const f of raw) {
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (ext === 'zip') {
        try {
          const extracted = await extractFilesFromZip(f);
          expanded.push(...extracted);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to unzip';
          dispatch({ type: 'UPLOAD_ERROR', error: `${f.name}: ${msg}` });
          return;
        }
      } else {
        expanded.push(f);
      }
    }

    const files = expanded.filter((f) => {
      const ext2 = '.' + f.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_EXTENSIONS.includes(ext2);
    });

    if (files.length === 0) {
      dispatch({ type: 'UPLOAD_ERROR', error: 'No valid files found. Expected .dxf, .json, or .csv (or a .zip containing them).' });
      return;
    }

    dispatch({ type: 'UPLOAD_START' });

    try {
      // Parse files entirely client-side.  The parsers are pure functions
      // with zero Node.js dependencies, so they run fine in the browser.
      // This avoids any server round-trip and the Vercel 4.5 MB body limit.
      const allPanels: PanelGeometry[] = [];
      const allShadeData: ShadeTimeseries = {};
      const allErrors: string[] = [];
      const allRadiancePoints: RadiancePoint[] = [];
      let shadeFidelity: ShadeFidelity = 'full';
      let shadeSource: ShadeSource = 'manual';

      for (const f of files) {
        const text = await f.text();
        const ext = f.name.split('.').pop()?.toLowerCase();

        if (ext === 'json') {
          const result = parseJSON(text);
          if (result.errors.length > 0) allErrors.push(...result.errors.map(e => `${f.name}: ${e}`));
          allPanels.push(...result.panels);
        } else if (ext === 'dxf') {
          const result = parseDXF(text);
          if (result.errors.length > 0) allErrors.push(...result.errors.map(e => `${f.name}: ${e}`));
          allPanels.push(...result.panels);
          allRadiancePoints.push(...result.radiancePoints);
        } else if (ext === 'csv') {
          const result = parseShadeCSV(text);
          if (result.errors.length > 0) allErrors.push(...result.errors.map(e => `${f.name}: ${e}`));
          Object.assign(allShadeData, result.data);
          shadeFidelity = result.fidelity;
          shadeSource = result.source;
        } else {
          allErrors.push(`${f.name}: Unsupported file type .${ext}`);
        }
      }

      if (allErrors.length > 0 && allPanels.length === 0) {
        throw new Error(allErrors.join('; '));
      }

      dispatch({
        type: 'UPLOAD_SUCCESS',
        panels: allPanels,
        shadeData: allShadeData,
        shadeFidelity,
        shadeSource,
        radiancePoints: allRadiancePoints,
        files: files.map((f) => ({
          name: f.name,
          type: f.name.split('.').pop()?.toLowerCase() as 'dxf' | 'json' | 'csv',
          size: f.size,
        })),
      });
    } catch (err) {
      dispatch({
        type: 'UPLOAD_ERROR',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [dispatch]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    // Check for directory entries (drag-and-drop folders)
    const items = e.dataTransfer.items;
    if (items?.length) {
      const allFiles: File[] = [];
      const entries = Array.from(items)
        .map(item => item.webkitGetAsEntry?.())
        .filter((e): e is FileSystemEntry => e != null);

      if (entries.some(entry => entry.isDirectory)) {
        // At least one folder was dropped — recursively collect files
        for (const entry of entries) {
          const files = await collectFilesFromEntry(entry);
          allFiles.push(...files);
        }
        handleFiles(allFiles);
        return;
      }
    }
    // Regular file drop
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Layout Files</h3>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-2 h-24 rounded-xl border-2 border-dashed border-t-border hover:border-orange-500 cursor-pointer transition-colors bg-surface-2 hover:bg-surface-elevated"
      >
        {isUploading ? (
          <span className="text-sm text-muted animate-pulse">Parsing files...</span>
        ) : (
          <>
            <span className="text-lg opacity-40">📐</span>
            <span className="text-xs text-muted">Drop files, folder, or zip here</span>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => fileInputRef.current?.click()}
          className="flex-1 text-xs text-muted hover:text-foreground transition-colors py-1 rounded border border-border hover:border-orange-500/50">
          Select files
        </button>
        <button type="button" onClick={() => folderInputRef.current?.click()}
          className="flex-1 text-xs text-muted hover:text-foreground transition-colors py-1 rounded border border-border hover:border-orange-500/50">
          Select folder
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept=".dxf,.json,.csv,.zip" multiple className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = '';
        }} />
      {/* @ts-expect-error — webkitdirectory is non-standard but widely supported */}
      <input ref={folderInputRef} type="file" webkitdirectory="" multiple className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = '';
        }} />
      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
      {uploadedFiles.length > 0 && (
        <div className="space-y-1">
          {uploadedFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-foreground truncate">{f.name}</span>
              <span className="text-muted uppercase">{f.type}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-t-border space-y-1">
            <span className="text-sm font-semibold text-orange-500">
              {panelCount} panels loaded
            </span>
            {panelCount === 0 && radiancePointCount > 0 && (
              <p className="text-xs text-muted">
                {radiancePointCount} radiance points from DXF — panel positions will be
                derived when the visualizer is built (Stage 3).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
