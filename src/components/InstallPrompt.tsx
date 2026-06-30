"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  // Never show on customer-facing portal pages (e.g. survey self-scheduling).
  const isPortal = pathname?.startsWith("/portal");

  useEffect(() => {
    if (isPortal) return;

    // Don't show if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Don't show if previously dismissed
    if (localStorage.getItem("pb-install-dismissed")) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [isPortal]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setVisible(false);
    setDeferredPrompt(null);
    localStorage.setItem("pb-install-dismissed", "1");
  };

  if (isPortal || !visible) return null;

  return (
    <div className="fixed bottom-6 left-4 right-4 z-[9999] mx-auto max-w-md animate-slideUp">
      <div className="flex items-center gap-3 rounded-2xl bg-surface-elevated border border-t-border p-4 shadow-card-lg">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Install PB Ops
          </p>
          <p className="text-xs text-muted mt-0.5">
            Add to your home screen for quick access
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="shrink-0 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white active:opacity-80"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-muted hover:text-foreground text-lg leading-none"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
