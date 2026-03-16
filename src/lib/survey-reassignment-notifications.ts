import { normalizeEmail } from "@/lib/email-utils";
import { sendReassignmentNotification } from "@/lib/email";

export type SurveyorInfo = {
  email: string | null;
  name: string | null;
  uid: string | null;
};

type SurveyorRecipient = {
  email: string;
  name: string;
};

type SendSurveyReassignmentNotificationsParams = {
  logPrefix: string;
  schedulerName: string;
  schedulerEmail: string;
  previousSurveyor: SurveyorInfo | null;
  currentSurveyor: SurveyorInfo | null;
  currentRecipients: SurveyorRecipient[];
  customerName: string;
  customerAddress: string;
  scheduledDate: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  projectId: string;
  zuperJobUid?: string;
  dealOwnerName?: string;
  notes?: string;
  googleCalendarEventUrl?: string;
  usedSchedulerFallback?: boolean;
  sendStandardSchedulingNotifications: () => Promise<void>;
};

export function mergeSurveyorInfo(primary: SurveyorInfo | null, fallback: SurveyorInfo | null): SurveyorInfo | null {
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    email: primary.email || fallback.email,
    name: primary.name || fallback.name,
    uid: primary.uid || fallback.uid,
  };
}

export function getSurveyorDisplayName(info?: SurveyorInfo | null): string | null {
  return info?.name || normalizeEmail(info?.email) || null;
}

function normalizeSurveyorName(value?: string | null): string | null {
  const normalized = (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  return normalized || null;
}

export function isSameSurveyor(previous: SurveyorInfo | null, current: SurveyorInfo | null): boolean {
  if (!previous || !current) return false;
  if (previous.uid && current.uid) return previous.uid === current.uid;

  const previousEmail = normalizeEmail(previous.email);
  const currentEmail = normalizeEmail(current.email);
  if (previousEmail && currentEmail) return previousEmail === currentEmail;

  const previousName = normalizeSurveyorName(previous.name);
  const currentName = normalizeSurveyorName(current.name);
  if (previousName && currentName) return previousName === currentName;

  return false;
}

export async function sendSurveyReassignmentNotifications(
  params: SendSurveyReassignmentNotificationsParams
): Promise<{ mode: "standard" | "reassignment" }> {
  const reassignmentDetected =
    !!params.previousSurveyor &&
    !!params.currentSurveyor &&
    !isSameSurveyor(params.previousSurveyor, params.currentSurveyor);

  if (!reassignmentDetected || params.usedSchedulerFallback) {
    await params.sendStandardSchedulingNotifications();
    return { mode: "standard" };
  }

  const previousSurveyorEmail = normalizeEmail(params.previousSurveyor?.email);
  const previousSurveyorDisplayName = getSurveyorDisplayName(params.previousSurveyor);

  if (previousSurveyorEmail) {
    const outgoingResult = await sendReassignmentNotification({
      to: previousSurveyorEmail,
      crewMemberName: previousSurveyorDisplayName || "Team Member",
      reassignedByName: params.schedulerName,
      reassignedByEmail: params.schedulerEmail,
      otherSurveyorName: params.currentSurveyor?.name || "Team Member",
      direction: "outgoing",
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      scheduledDate: params.scheduledDate,
      scheduledStart: params.scheduledStart,
      scheduledEnd: params.scheduledEnd,
      projectId: params.projectId,
      zuperJobUid: params.zuperJobUid,
      dealOwnerName: params.dealOwnerName,
      notes: params.notes,
    });
    if (!outgoingResult.success) {
      console.warn(
        `[${params.logPrefix}] Survey reassignment outgoing email warning for ${params.projectId}: ${outgoingResult.error || "unknown error"}`
      );
    }
  } else {
    console.warn(`[${params.logPrefix}] No previous surveyor email resolved for reassignment on ${params.projectId}; skipping outgoing email`);
  }

  if (!previousSurveyorDisplayName) {
    await params.sendStandardSchedulingNotifications();
    return { mode: "standard" };
  }

  for (const recipient of params.currentRecipients) {
    const incomingResult = await sendReassignmentNotification({
      to: recipient.email,
      crewMemberName: recipient.name,
      reassignedByName: params.schedulerName,
      reassignedByEmail: params.schedulerEmail,
      otherSurveyorName: previousSurveyorDisplayName,
      direction: "incoming",
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      scheduledDate: params.scheduledDate,
      scheduledStart: params.scheduledStart,
      scheduledEnd: params.scheduledEnd,
      projectId: params.projectId,
      zuperJobUid: params.zuperJobUid,
      dealOwnerName: params.dealOwnerName,
      notes: params.notes,
      googleCalendarEventUrl: params.googleCalendarEventUrl,
    });
    if (!incomingResult.success) {
      console.warn(
        `[${params.logPrefix}] Survey reassignment incoming email warning for ${params.projectId}: ${incomingResult.error || "unknown error"}`
      );
    }
  }

  return { mode: "reassignment" };
}
