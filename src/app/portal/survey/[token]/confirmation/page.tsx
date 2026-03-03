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
          // Not scheduled — go back to main page
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

  const handleCancel = useCallback(async () => {
    if (cancelling) return;
    if (!confirm("Are you sure you want to cancel your survey?")) return;

    setCancelling(true);
    try {
      const res = await fetch(`/api/portal/survey/${token}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: cancelIdempotencyKey.current }),
      });

      if (res.ok) {
        setState({ type: "cancelled" });
      } else {
        const body = await res.json();
        alert(body.error || "Unable to cancel. Please call us for help.");
      }
    } catch {
      alert("Unable to connect. Please try again.");
    } finally {
      setCancelling(false);
    }
  }, [cancelling, token]);

  const handleReschedule = useCallback(() => {
    // Navigate back to the main scheduling page — the API will show available slots
    // since the reschedule flow re-uses the book endpoint after freeing the old slot
    router.push(`/portal/survey/${token}`);
  }, [token, router]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (state.type === "loading") {
    return (
      <div className="animate-pulse space-y-4 py-8">
        <div className="mx-auto h-12 w-12 rounded-full bg-skeleton" />
        <div className="mx-auto h-6 w-48 rounded bg-skeleton" />
        <div className="mx-auto h-4 w-64 rounded bg-skeleton" />
        <div className="h-24 rounded-lg bg-skeleton" />
      </div>
    );
  }

  if (state.type === "error") {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">{state.message}</p>
      </div>
    );
  }

  if (state.type === "cancelled") {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">Survey Cancelled</h2>
        <p className="text-sm text-muted">
          Your site survey has been cancelled. If you&apos;d like to reschedule,
          please contact your Photon Brothers representative.
        </p>
      </div>
    );
  }

  const { data } = state;
  const { booking } = data;

  // Format date for display
  const dateObj = new Date(booking.date + "T12:00:00Z");
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  // Format time for display
  const [h, m] = booking.time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const formattedTime = `${hour12}:${m.toString().padStart(2, "0")} ${period}`;

  // Google Calendar link
  const startDt = `${booking.date.replace(/-/g, "")}T${booking.time.replace(":", "")}00`;
  const endH = h + 1;
  const endDt = `${booking.date.replace(/-/g, "")}T${endH.toString().padStart(2, "0")}${m.toString().padStart(2, "0")}00`;
  const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent("Site Survey - Photon Brothers")}&dates=${startDt}/${endDt}&details=${encodeURIComponent(`Site survey at ${data.propertyAddress}\n\nPhoton Brothers will visit your property to assess your solar installation. The survey takes about 1 hour.`)}&location=${encodeURIComponent(data.propertyAddress)}`;

  return (
    <div className="space-y-6">
      {/* Success header */}
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground">Survey Confirmed!</h2>
        <p className="mt-1 text-sm text-muted">We&apos;ll see you soon.</p>
      </div>

      {/* Booking details card */}
      <div className="rounded-lg border border-t-border bg-surface p-4 space-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Date</p>
          <p className="text-sm font-medium text-foreground">{formattedDate}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Time</p>
          <p className="text-sm font-medium text-foreground">{formattedTime} (1 hour)</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Location</p>
          <p className="text-sm text-foreground">{data.propertyAddress}</p>
        </div>
        {booking.accessNotes && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Your Notes</p>
            <p className="text-sm text-foreground">{booking.accessNotes}</p>
          </div>
        )}
      </div>

      {/* Add to calendar */}
      <a
        href={calendarUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-t-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Add to Google Calendar
      </a>

      {/* What to expect */}
      <div className="rounded-lg border border-t-border bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">What to Expect</h3>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>A Photon Brothers surveyor will visit your property</li>
          <li>They&apos;ll assess your roof, electrical panel, and sun exposure</li>
          <li>The visit typically takes about 1 hour</li>
          <li>Please ensure access to your main electrical panel</li>
        </ul>
      </div>

      {/* Reschedule / Cancel */}
      {booking.canModify && (
        <div className="flex gap-3">
          <button
            onClick={handleReschedule}
            className="flex-1 rounded-lg border border-t-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            Reschedule
          </button>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            {cancelling ? "Cancelling..." : "Cancel Survey"}
          </button>
        </div>
      )}
    </div>
  );
}
