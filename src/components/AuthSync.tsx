"use client";

import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

/**
 * Component that syncs the current user to the database after login.
 * This ensures users are created in the DB and their role is recorded.
 * After sync, triggers a session update so the JWT refreshes from a
 * Node.js context where Prisma can actually resolve the DB role.
 * Place this in the root layout to run on every page load.
 */
export function AuthSync() {
  const { data: session, status, update } = useSession();
  const syncedRef = useRef(false);

  useEffect(() => {
    // Only sync once per session and only when authenticated
    if (status === "authenticated" && session?.user?.email && !syncedRef.current) {
      syncedRef.current = true;

      // Call the sync endpoint to ensure user exists in DB
      fetch("/api/auth/sync", { method: "POST" })
        .then((res) => res.json())
        .then(async (data) => {
          if (data.synced) {
            const dbPrimaryRole = data.roles?.[0];
            const jwtPrimaryRole = session?.user?.roles?.[0];
            if (dbPrimaryRole && dbPrimaryRole !== jwtPrimaryRole) {
              console.log("[AuthSync] JWT roles mismatch, refreshing session token");
              await update();
            }
          }
        })
        .catch((err) => {
          console.error("[AuthSync] Failed to sync user:", err);
        });
    }
  }, [session, status, update]);

  return null; // This component renders nothing
}
