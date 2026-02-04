"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: "bg-green-900/90",
    border: "border-green-500/30",
    text: "text-green-400",
    icon: "\u2713",
  },
  error: {
    bg: "bg-red-900/90",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: "!",
  },
  warning: {
    bg: "bg-yellow-900/90",
    border: "border-yellow-500/30",
    text: "text-yellow-400",
    icon: "\u26A0",
  },
  info: {
    bg: "bg-blue-900/90",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: "i",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { ...toast, id }]);

      // Auto-remove after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => {
            const colors = TOAST_COLORS[toast.type];
            return (
              <div
                key={toast.id}
                className={`${colors.bg} ${colors.border} border rounded-lg px-4 py-3 shadow-lg backdrop-blur-sm animate-slideUp`}
              >
                <div className="flex items-start gap-3">
                  <span className={`${colors.text} font-bold text-lg leading-none`}>
                    {colors.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${colors.text}`}>
                      {toast.title}
                    </div>
                    {toast.message && (
                      <div className="text-xs text-zinc-400 mt-0.5">
                        {toast.message}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeToast(toast.id)}
                    className="text-zinc-500 hover:text-zinc-300 text-sm"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
}
