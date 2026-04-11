"use client";

import { useState } from "react";

interface Props {
  impersonating?: boolean;
}

export default function CommsConnectBanner({ impersonating }: Props) {
  const [loading, setLoading] = useState(false);

  if (impersonating) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center">
        <h3 className="text-lg font-semibold text-foreground">
          Comms Unavailable
        </h3>
        <p className="mt-1 text-sm text-muted">
          Comms is not available while impersonating another user. Exit
          impersonation to access your inbox.
        </p>
      </div>
    );
  }

  async function handleConnect() {
    setLoading(true);
    try {
      const resp = await fetch("/api/comms/connect");
      const data = await resp.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-8 text-center">
      <h3 className="text-lg font-semibold text-foreground">
        Connect Your Gmail
      </h3>
      <p className="mt-2 text-sm text-muted">
        Connect your Gmail account to view your inbox, Google Chat messages, and
        HubSpot notifications in one place.
      </p>
      <button
        onClick={handleConnect}
        disabled={loading}
        className="mt-4 rounded-lg bg-cyan-600 px-6 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
      >
        {loading ? "Connecting..." : "Connect Gmail"}
      </button>
    </div>
  );
}
