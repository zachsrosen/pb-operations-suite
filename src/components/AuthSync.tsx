"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

/**
 * Component that syncs the current user to the database after login.
 * This ensures users are created in the DB and their role is recorded.
 * Place this in the root layout to run on every page load.
 */
export function AuthSync() {
  const { data: session, status } = useSession();
  const syncedRef = useRef(false);

  useEffect(() => {
    // Only sync once per session and only when authenticated
    if (status === "authenticated" && session?.user?.email && !syncedRef.current) {
      syncedRef.current = true;

      // Call the sync endpoint to ensure user exists in DB
      fetch("/api/auth/sync", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.synced) {
            console.log("[AuthSync] User synced:", data.user?.email, "Role:", data.role);
          }
        })
        .catch((err) => {
          console.error("[AuthSync] Failed to sync user:", err);
        });
    }
  }, [session, status]);

  return null; // This component renders nothing
}
