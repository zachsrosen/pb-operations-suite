'use client';

import { useRef, useCallback } from 'react';
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

export default function FileUploadPanel({
  uploadedFiles, panelCount, radiancePointCount, isUploading, uploadError, dispatch,
}: FileUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_EXTENSIONS.includes(ext);
    });

    if (files.length === 0) {
      dispatch({ type: 'UPLOAD_ERROR', error: 'No valid files. Expected .dxf, .json, or .csv' });
      return;
    }

    dispatch({ type: 'UPLOAD_START' });

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/solar-designer/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        let errorMsg = `Upload failed (${res.status})`;
        try {
          const err = await res.json();
          if (err.error) errorMsg = err.error;
        } catch {
          // Response body not JSON (e.g. Vercel error page) — use status-based message
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();

      if (data.errors?.length > 0 && data.panels.length === 0) {
        throw new Error(data.errors.join('; '));
      }

      dispatch({
        type: 'UPLOAD_SUCCESS',
        panels: data.panels,
        shadeData: data.shadeData,
        shadeFidelity: data.shadeFidelity,
        shadeSource: data.shadeSource,
        radiancePointCount: data.radiancePointCount ?? 0,
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
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
            <span className="text-xs text-muted">Drop DXF, JSON, or CSV files here</span>
          </>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept=".dxf,.json,.csv" multiple className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          // Reset so re-selecting the same file triggers onChange
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
