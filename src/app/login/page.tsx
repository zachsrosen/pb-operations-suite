"use client";

import { useState, Suspense, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type LoginStep = "email" | "code";

function LoginForm() {
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [verificationToken, setVerificationToken] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Auto-focus first code input when step changes to code
  useEffect(() => {
    if (step === "code" && codeInputRefs.current[0]) {
      codeInputRefs.current[0].focus();
    }
  }, [step]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setVerificationToken(data.token);
        setStep("code");
        setCountdown(60); // 60 seconds before allowing resend
      } else {
        setError(data.error || "Failed to send verification code");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-advance to next input
    if (value && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (value && index === 5 && newCode.every((d) => d)) {
      handleCodeSubmit(newCode.join(""));
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    // Handle backspace
    if (e.key === "Backspace" && !code[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedData.length === 6) {
      const newCode = pastedData.split("");
      setCode(newCode);
      handleCodeSubmit(pastedData);
    }
  };

  const handleCodeSubmit = async (codeString?: string) => {
    const fullCode = codeString || code.join("");
    if (fullCode.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: fullCode, token: verificationToken }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push(redirect);
        router.refresh();
      } else {
        setError(data.error || "Invalid code");
        // Update token if a new one was provided (for attempt tracking)
        if (data.token) {
          setVerificationToken(data.token);
        }
        // Clear code on error
        setCode(["", "", "", "", "", ""]);
        codeInputRefs.current[0]?.focus();
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (countdown > 0) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setVerificationToken(data.token);
        setCountdown(60);
        setCode(["", "", "", "", "", ""]);
        codeInputRefs.current[0]?.focus();
      } else {
        setError(data.error || "Failed to resend code");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (step === "code") {
    return (
      <div>
        <div className="mb-6 text-center">
          <p className="text-zinc-400 text-sm">
            We sent a code to
          </p>
          <p className="text-white font-medium">{email}</p>
        </div>

        <div className="flex justify-center gap-2 mb-6">
          {code.map((digit, index) => (
            <input
              key={index}
              ref={(el) => { codeInputRefs.current[index] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleCodeChange(index, e.target.value)}
              onKeyDown={(e) => handleCodeKeyDown(index, e)}
              onPaste={handleCodePaste}
              className="w-12 h-14 text-center text-2xl font-mono bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg text-white focus:outline-none focus:border-orange-500 transition-colors"
              disabled={loading}
            />
          ))}
        </div>

        {error && (
          <div className="mb-4 text-red-500 text-sm text-center">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => handleCodeSubmit()}
          disabled={loading || code.some((d) => !d)}
          className="w-full bg-gradient-to-r from-orange-500 to-orange-400 text-black font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {loading ? "Verifying..." : "Verify Code"}
        </button>

        <div className="text-center space-y-2">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={countdown > 0 || loading}
            className="text-sm text-zinc-500 hover:text-orange-400 transition-colors disabled:hover:text-zinc-500"
          >
            {countdown > 0 ? `Resend code in ${countdown}s` : "Resend code"}
          </button>

          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode(["", "", "", "", "", ""]);
              setVerificationToken("");
              setError("");
            }}
            className="block w-full text-sm text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleEmailSubmit}>
      <div className="mb-6">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your.name@photonbrothers.com"
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500 transition-colors"
          autoFocus
          autoComplete="email"
        />
      </div>

      {error && (
        <div className="mb-4 text-red-500 text-sm text-center">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !email}
        className="w-full bg-gradient-to-r from-orange-500 to-orange-400 text-black font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending code..." : "Continue with Email"}
      </button>

      <p className="text-center text-zinc-600 text-xs mt-4">
        We&apos;ll send you a verification code
      </p>
    </form>
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
              Sign in with your Photon Brothers email
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
