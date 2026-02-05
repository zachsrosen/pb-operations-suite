"use client";

import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";

export function UserMenu() {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch user role from DB
  useEffect(() => {
    if (session?.user?.email) {
      fetch("/api/auth/sync")
        .then(res => res.json())
        .then(data => {
          if (data.role) {
            setUserRole(data.role);
          }
        })
        .catch(() => {});
    }
  }, [session]);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="text-xs text-zinc-500 border border-zinc-800 rounded-lg px-3 py-1.5 hover:border-zinc-600 hover:text-zinc-400 transition-colors"
      >
        Sign In
      </Link>
    );
  }

  const initials = session.user.name
    ?.split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  const isAdmin = userRole === "ADMIN";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs text-zinc-400 border border-zinc-800 rounded-lg px-2 py-1.5 hover:border-zinc-600 hover:text-zinc-300 transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-medium">
          {initials}
        </div>
        <span className="hidden sm:inline max-w-[100px] truncate">
          {session.user.name?.split(" ")[0] || session.user.email?.split("@")[0]}
        </span>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-[#1a1a24] border border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-zinc-800">
            <p className="text-sm font-medium text-white truncate">{session.user.name}</p>
            <p className="text-xs text-zinc-500 truncate">{session.user.email}</p>
            {userRole && (
              <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${
                userRole === "ADMIN" ? "bg-red-500/20 text-red-400" :
                userRole === "MANAGER" ? "bg-purple-500/20 text-purple-400" :
                userRole === "SALES" ? "bg-cyan-500/20 text-cyan-400" :
                "bg-zinc-500/20 text-zinc-400"
              }`}>
                {userRole}
              </span>
            )}
          </div>

          <div className="py-1">
            {isAdmin && (
              <>
                <Link
                  href="/admin/users"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                  Manage Users
                </Link>
                <Link
                  href="/admin/activity"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Activity Log
                </Link>
              </>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
