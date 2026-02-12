"use client";

import { useState, useEffect, useCallback } from "react";

interface ImpersonationState {
  isImpersonating: boolean;
  impersonating?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
  admin?: {
    id: string;
    email: string;
    name: string | null;
  };
}

export default function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState>({ isImpersonating: false });
  const [ending, setEnding] = useState(false);

  const checkImpersonation = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/impersonate");
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } catch (error) {
      console.error("Failed to check impersonation status:", error);
    }
  }, []);

  useEffect(() => {
    checkImpersonation();
    // Check periodically in case impersonation state changes
    const interval = setInterval(checkImpersonation, 30000);
    return () => clearInterval(interval);
  }, [checkImpersonation]);

  const endImpersonation = async () => {
    setEnding(true);
    try {
      const res = await fetch("/api/admin/impersonate", { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        // Navigate to home to reset all state (don't reload — may be on a locked route)
        window.location.href = "/";
      } else {
        alert("Failed to exit impersonation: " + (data.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Failed to end impersonation:", error);
      alert("Failed to exit impersonation. Please try again.");
    } finally {
      setEnding(false);
    }
  };

  if (!state.isImpersonating) {
    return null;
  }

  return (
    <div role="alert" aria-live="assertive" className="sticky top-0 left-0 right-0 z-[100] bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600 text-white px-4 py-2 shadow-lg">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="font-bold">IMPERSONATING:</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {state.impersonating?.name || state.impersonating?.email}
            </span>
            <span className="text-amber-200 text-sm">
              ({state.impersonating?.role})
            </span>
          </div>
          <span className="text-amber-200/80 text-sm hidden sm:inline">
            | Logged in as: {state.admin?.email}
          </span>
        </div>
        <button
          onClick={endImpersonation}
          disabled={ending}
          className="flex items-center gap-2 px-4 py-1.5 bg-white/20 hover:bg-white/30 disabled:bg-white/10 rounded-lg font-medium transition-colors text-sm"
        >
          {ending ? (
            <>
              <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
              Ending...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Exit Impersonation
            </>
          )}
        </button>
      </div>
    </div>
  );
}
