"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
// useRef retained for hydratedFromDraftRef — set inside effects only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface Props<TPayload extends Record<string, unknown>> {
  dealId: string;
  actionKind: string;
  title: string;
  children: (
    value: Partial<TPayload>,
    update: (patch: Partial<TPayload>) => void,
  ) => ReactNode;
  onSubmit: (payload: TPayload) => Promise<void>;
  validate: (value: Partial<TPayload>) => string | null;
  initialValue?: Partial<TPayload>;
}

export function FormShell<TPayload extends Record<string, unknown>>({
  dealId,
  actionKind,
  title,
  children,
  onSubmit,
  validate,
  initialValue = {},
}: Props<TPayload>) {
  const qc = useQueryClient();
  const [value, setValue] = useState<Partial<TPayload>>(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isDirty, setIsDirty] = useState(false);
  const hydratedFromDraftRef = useRef(false);

  const draftQuery = useQuery<{
    draft: { payload: Partial<TPayload> } | null;
  }>({
    queryKey: queryKeys.permitHub.draft(dealId, actionKind),
    queryFn: async () => {
      const r = await fetch(`/api/permit-hub/drafts/${dealId}/${actionKind}`);
      if (!r.ok) return { draft: null };
      return r.json();
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!hydratedFromDraftRef.current && draftQuery.data?.draft?.payload) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from cached draft
      setValue(draftQuery.data.draft.payload);
      hydratedFromDraftRef.current = true;
    }
  }, [draftQuery.data]);

  // Debounced auto-save driven by value changes.
  useEffect(() => {
    if (!isDirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cosmetic "Saving..." indicator
    setStatus("saving");
    const handle = setTimeout(() => {
      fetch("/api/permit-hub/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, actionKind, payload: value }),
      })
        .then(() => setStatus("saved"))
        .catch(() => setStatus("idle"));
    }, 750);
    return () => clearTimeout(handle);
  }, [value, isDirty, dealId, actionKind]);

  const update = useCallback((patch: Partial<TPayload>) => {
    setValue((v) => ({ ...v, ...patch }));
    setIsDirty(true);
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const validationError = validate(value);
      if (validationError) throw new Error(validationError);
      await onSubmit(value as TPayload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.permitHub.queue() });
      qc.invalidateQueries({ queryKey: queryKeys.permitHub.project(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.permitHub.todayCount() });
      qc.invalidateQueries({
        queryKey: queryKeys.permitHub.draft(dealId, actionKind),
      });
      setValue({});
      setIsDirty(false);
      hydratedFromDraftRef.current = false;
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitMutation.mutate();
      }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">{title}</h4>
        <span className="text-muted text-xs">
          {status === "saving"
            ? "Saving draft…"
            : status === "saved"
              ? "Draft saved"
              : ""}
        </span>
      </div>

      {children(value, update)}

      {error && (
        <div className="rounded-md bg-red-500/10 p-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitMutation.isPending}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {submitMutation.isPending ? "Submitting…" : "Submit"}
        </button>
      </div>
    </form>
  );
}
