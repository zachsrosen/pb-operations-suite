"use client";

import { useEffect, useRef } from "react";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import type { ModeReason, SolarMode } from "@/lib/solar/native-mode";

interface ClassicWorkspaceProps {
  serverDefault: SolarMode;
  modeReason: ModeReason;
  source: "initial" | "toggle";
}

export default function ClassicWorkspace({
  serverDefault,
  modeReason,
  source,
}: ClassicWorkspaceProps) {
  const { trackFeature } = useActivityTracking();
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackFeature("solar_classic_view", undefined, {
      serverDefault,
      modeReason,
      forceClassicLocked: modeReason === "env_force_classic",
      source,
    });
  }, [trackFeature, serverDefault, modeReason, source]);

  return (
    <div
      className="-mx-4 sm:-mx-6 -mb-6"
      style={{ height: "calc(100vh - 120px)" }}
    >
      <iframe
        src="/solar-surveyor/index.html"
        className="w-full h-full border-none"
        title="Solar Surveyor V12"
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
