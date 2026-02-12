"use client";

import Link from "next/link";
import { useState } from "react";

export default function UnassignedPage() {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-6">
      {open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#151520] border border-zinc-700 rounded-xl p-6 shadow-2xl">
            <h1 className="text-lg font-semibold text-orange-400">Access Pending</h1>
            <p className="text-sm text-zinc-300 mt-3">
              Your account is currently unassigned.
            </p>
            <p className="text-sm text-zinc-300 mt-2">
              Contact Zach Rosen for permissions.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-sm rounded-md bg-orange-600 hover:bg-orange-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-xl text-center">
        <h2 className="text-xl font-semibold">Unassigned Account</h2>
        <p className="text-zinc-400 mt-3">
          You do not currently have dashboard permissions.
        </p>
        <p className="text-zinc-400 mt-1">
          Contact Zach Rosen to request access.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-block px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm"
          >
            Return to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
