/**
 * Portal — Survey Booking Confirmation
 *
 * Shows the confirmed booking details, "Add to Calendar" link,
 * and reschedule/cancel options (if within the 24h cutoff).
 */

"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookingData {
  customerName: string;
  propertyAddress: string;
  pbLocation: string;
  booking: {
    date: string;
    time: string;
    accessNotes: string | null;
    canModify: boolean;
  };
}

type PageState =
  | { type: "loading" }
  | { type: "error"; message: string }
  | { type: "data"; data: BookingData }
  | { type: "cancelled" };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SurveyConfirmationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [state, setState] = useState<PageState>({ type: "loading" });
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelIdempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/portal/survey/${token}`);
        if (!res.ok) {
          setState({ type: "error", message: "Unable to load your booking." });
          return;
        }
        const data = await res.json();
        if (data.status !== "scheduled") {
          router.replace(`/portal/survey/${token}`);
          return;
        }
        setState({ type: "data", data });
      } catch {
        setState({ type: "error", message: "Unable to connect. Please try again." });
      }
    }
    load();
  }, [token, router]);

  const handleCancelClick = useCallback(() => {
    setCancelError(null);
    setCancelConfirmOpen(true);
  }, []);

  const handleCancelConfirm = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/portal/survey/${token}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: cancelIdempotencyKey.current }),
      });
      if (res.ok) {
        setState({ type: "cancelled" });
        setCancelConfirmOpen(false);
      } else {
        const body = await res.json().catch(() => ({}));
        setCancelError(body.error || "Unable to cancel. Please call us for help.");
      }
    } catch {
      setCancelError("Unable to connect. Please try again.");
    } finally {
      setCancelling(false);
    }
  }, [cancelling, token]);

  const handleCancelDismiss = useCallback(() => {
    if (cancelling) return;
    setCancelConfirmOpen(false);
    setCancelError(null);
  }, [cancelling]);

  const handleReschedule = useCallback(() => {
    router.push(`/portal/survey/${token}?reschedule=1`);
  }, [token, router]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (state.type === "loading") {
    return (
      <div className="animate-pulse space-y-6 py-8">
        <div className="mx-auto h-14 w-14 rounded-full bg-gray-200" />
        <div className="mx-auto h-7 w-48 rounded-lg bg-gray-200" />
        <div className="mx-auto h-4 w-64 rounded-lg bg-gray-200" />
        <div className="h-32 rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (state.type === "error") {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[#6B7280]">{state.message}</p>
      </div>
    );
  }

  if (state.type === "cancelled") {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
          <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-[#323F4D]">Survey Cancelled</h2>
        <p className="mb-8 text-sm text-[#6B7280]">
          Your site survey has been cancelled. Would you like to pick a new time?
        </p>
        <button
          onClick={() => router.push(`/portal/survey/${token}`)}
          className="rounded-lg bg-[#FF9E1B] px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#DF8407]"
        >
          Reschedule Survey
        </button>
      </div>
    );
  }

  const { data } = state;
  const { booking } = data;

  const dateObj = new Date(booking.date + "T12:00:00Z");
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const [h, m] = booking.time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const formattedTime = `${hour12}:${m.toString().padStart(2, "0")} ${period}`;

  const startDt = `${booking.date.replace(/-/g, "")}T${booking.time.replace(":", "")}00`;
  const endH = h + 1;
  const endDt = `${booking.date.replace(/-/g, "")}T${endH.toString().padStart(2, "0")}${m.toString().padStart(2, "0")}00`;
  const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Site Survey - Photon Brothers")}&dates=${startDt}/${endDt}&details=${encodeURIComponent(`Site survey at ${data.propertyAddress}\n\nPhoton Brothers will visit your property to assess your solar installation. The survey takes about 1 hour.`)}&location=${encodeURIComponent(data.propertyAddress)}`;

  return (
    <div className="space-y-6">
      {/* Success header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-100">
          <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-[#323F4D]">Survey Confirmed!</h2>
        <p className="mt-1.5 text-[15px] text-[#6B7280]">We&apos;ll see you soon.</p>
      </div>

      {/* Booking details card */}
      <div className="divide-y divide-[#E5E7EB] rounded-lg border border-[#E5E7EB] bg-white">
        <div className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Date</p>
          <p className="mt-1 text-[15px] font-semibold text-[#323F4D]">{formattedDate}</p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Time</p>
          <p className="mt-1 text-[15px] font-semibold text-[#323F4D]">{formattedTime} <span className="font-normal text-[#6B7280]">(1 hour)</span></p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Location</p>
          <p className="mt-1 text-[15px] text-[#323F4D]">{data.propertyAddress}</p>
        </div>
        {booking.accessNotes && (
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Your Notes</p>
            <p className="mt-1 text-sm text-[#323F4D]">{booking.accessNotes}</p>
          </div>
        )}
      </div>

      {/* Add to calendar */}
      <a
        href={calendarUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm font-medium text-[#323F4D] transition-colors hover:border-[#FF9E1B]"
      >
        <svg className="h-4.5 w-4.5 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Add to Google Calendar
      </a>

      {/* What to expect */}
      <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-5">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-[#6B7280]">What to Expect</h3>
        <ul className="space-y-2.5">
          {[
            "A Photon Brothers surveyor will visit your property",
            "They'll assess your roof, electrical panel, and sun exposure",
            "The visit typically takes about 1 hour",
            "Please ensure access to your main electrical panel",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-[#323F4D]">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#FF9E1B]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Reschedule / Cancel */}
      {booking.canModify && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <button
              onClick={handleReschedule}
              className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-sm font-medium text-[#323F4D] transition-colors hover:border-[#FF9E1B]"
            >
              Reschedule
            </button>
            <button
              onClick={handleCancelClick}
              className="flex-1 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              Cancel Survey
            </button>
          </div>

          {cancelConfirmOpen && (
            <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-4">
              <p className="text-sm font-medium text-[#323F4D]">
                Cancel your scheduled site survey?
              </p>
              <p className="mt-1 text-sm text-[#6B7280]">
                We&apos;ll free up the slot. If you change your mind later, you can use this same link to reschedule.
              </p>

              {cancelError && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {cancelError}
                </div>
              )}

              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleCancelDismiss}
                  disabled={cancelling}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#323F4D] transition-colors hover:border-[#FF9E1B] disabled:opacity-50"
                >
                  Keep my appointment
                </button>
                <button
                  type="button"
                  onClick={handleCancelConfirm}
                  disabled={cancelling}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {cancelling ? "Cancelling…" : "Yes, cancel"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
