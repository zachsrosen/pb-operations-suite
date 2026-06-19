"use client";

import DashboardShell from "@/components/DashboardShell";

const ATLAS_URL = "https://atlas.photonbrothers.com/";

export default function AtlasPage() {
  return (
    <DashboardShell
      title="Atlas"
      accentColor="cyan"
      fullWidth
      headerRight={
        <a
          href={ATLAS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-cyan-400 transition-colors"
        >
          Open in new tab
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      }
    >
      <div
        className="-mx-4 sm:-mx-6 -mb-6"
        style={{ height: "calc(100vh - 120px)" }}
      >
        <iframe
          src={ATLAS_URL}
          className="w-full h-full border-none"
          title="Atlas"
          allow="clipboard-read; clipboard-write; geolocation; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        />
      </div>
    </DashboardShell>
  );
}
