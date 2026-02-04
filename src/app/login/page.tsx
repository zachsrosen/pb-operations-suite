"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const errorParam = searchParams.get("error");

  // Map NextAuth error codes to user-friendly messages
  const getErrorMessage = (error: string | null) => {
    switch (error) {
      case "AccessDenied":
        return "Access denied. Only @photonbrothers.com accounts are allowed.";
      case "Configuration":
        return "Server configuration error. Please contact support.";
      case "Verification":
        return "The verification link has expired or has already been used.";
      default:
        return error ? "An error occurred during sign in. Please try again." : null;
    }
  };

  const errorMessage = getErrorMessage(errorParam);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError("");
    try {
      await signIn("google", { callbackUrl });
    } catch (err) {
      setError("Failed to initiate sign in. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div>
      {(error || errorMessage) && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400 text-sm text-center">
            {error || errorMessage}
          </p>
        </div>
      )}

      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-900 font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        )}
        <span>{loading ? "Signing in..." : "Sign in with Google"}</span>
      </button>

      <p className="text-center text-zinc-500 text-xs mt-6">
        Only @photonbrothers.com accounts are allowed
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-orange-400 bg-clip-text text-transparent">
              PB Operations Suite
            </h1>
            <p className="text-zinc-500 text-sm mt-2">
              Sign in with your Photon Brothers account
            </p>
          </div>

          <Suspense fallback={<div className="text-center text-zinc-500">Loading...</div>}>
            <LoginForm />
          </Suspense>

          <p className="text-center text-zinc-600 text-xs mt-6">
            By Zach Rosen
          </p>
        </div>
      </div>
    </div>
  );
}
