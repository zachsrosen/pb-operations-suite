const mockSendReassignmentNotification = jest.fn();

jest.mock("@/lib/email", () => ({
  sendReassignmentNotification: mockSendReassignmentNotification,
}));

import {
  getSurveyorDisplayName,
  isSameSurveyor,
  sendSurveyReassignmentNotifications,
  type SurveyorInfo,
} from "@/lib/survey-reassignment-notifications";

describe("survey reassignment notifications", () => {
  const basePrevious: SurveyorInfo = {
    email: "derek@photonbrothers.com",
    name: "Derek Thompson",
    uid: "old-user",
  };
  const baseCurrent: SurveyorInfo = {
    email: "sam.paro@photonbrothers.com",
    name: "Sam Paro",
    uid: "new-user",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockSendReassignmentNotification.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses surveyor email as a display fallback when name is missing", () => {
    expect(getSurveyorDisplayName({ email: "sam.paro@photonbrothers.com", name: null, uid: null })).toBe(
      "sam.paro@photonbrothers.com"
    );
  });

  it("treats matching emails as the same surveyor when uid is missing", () => {
    expect(
      isSameSurveyor(
        { email: "Sam.Paro@photonbrothers.com", name: null, uid: null },
        { email: "sam.paro@photonbrothers.com", name: "Sam Paro", uid: null }
      )
    ).toBe(true);
  });

  it("sends outgoing and incoming reassignment emails when the surveyor changes", async () => {
    const fallback = jest.fn().mockResolvedValue(undefined);

    const result = await sendSurveyReassignmentNotifications({
      logPrefix: "Zuper Schedule",
      schedulerName: "Sarah Miller",
      schedulerEmail: "sarah@photonbrothers.com",
      previousSurveyor: basePrevious,
      currentSurveyor: baseCurrent,
      currentRecipients: [{ email: "sam.paro@photonbrothers.com", name: "Sam Paro" }],
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      scheduledDate: "2026-03-16",
      scheduledStart: "09:00",
      scheduledEnd: "10:00",
      projectId: "PROJ-1234",
      zuperJobUid: "job-123",
      dealOwnerName: "Mike Chen",
      notes: "Gate code 2468",
      googleCalendarEventUrl: "https://calendar.google.com/event?eid=123",
      sendStandardSchedulingNotifications: fallback,
    });

    expect(result).toEqual({ mode: "reassignment" });
    expect(fallback).not.toHaveBeenCalled();
    expect(mockSendReassignmentNotification).toHaveBeenCalledTimes(2);
    expect(mockSendReassignmentNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: "derek@photonbrothers.com",
        direction: "outgoing",
        otherSurveyorName: "Sam Paro",
      })
    );
    expect(mockSendReassignmentNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: "sam.paro@photonbrothers.com",
        direction: "incoming",
        otherSurveyorName: "Derek Thompson",
        googleCalendarEventUrl: "https://calendar.google.com/event?eid=123",
      })
    );
  });

  it("skips the outgoing email when the previous surveyor email is missing but still notifies the new surveyor", async () => {
    const fallback = jest.fn().mockResolvedValue(undefined);

    const result = await sendSurveyReassignmentNotifications({
      logPrefix: "Zuper Schedule",
      schedulerName: "Sarah Miller",
      schedulerEmail: "sarah@photonbrothers.com",
      previousSurveyor: { ...basePrevious, email: null },
      currentSurveyor: baseCurrent,
      currentRecipients: [{ email: "sam.paro@photonbrothers.com", name: "Sam Paro" }],
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      scheduledDate: "2026-03-16",
      projectId: "PROJ-1234",
      sendStandardSchedulingNotifications: fallback,
    });

    expect(result).toEqual({ mode: "reassignment" });
    expect(fallback).not.toHaveBeenCalled();
    expect(mockSendReassignmentNotification).toHaveBeenCalledTimes(1);
    expect(mockSendReassignmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "sam.paro@photonbrothers.com",
        direction: "incoming",
        otherSurveyorName: "Derek Thompson",
      })
    );
  });

  it("falls back to the standard scheduling notification when the previous surveyor identity is too incomplete", async () => {
    const fallback = jest.fn().mockResolvedValue(undefined);

    const result = await sendSurveyReassignmentNotifications({
      logPrefix: "Zuper Confirm",
      schedulerName: "Sarah Miller",
      schedulerEmail: "sarah@photonbrothers.com",
      previousSurveyor: { email: null, name: null, uid: null },
      currentSurveyor: baseCurrent,
      currentRecipients: [{ email: "sam.paro@photonbrothers.com", name: "Sam Paro" }],
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      scheduledDate: "2026-03-16",
      projectId: "PROJ-1234",
      sendStandardSchedulingNotifications: fallback,
    });

    expect(result).toEqual({ mode: "standard" });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(mockSendReassignmentNotification).not.toHaveBeenCalled();
  });

  it("falls back to the standard scheduling notification when the surveyor did not actually change", async () => {
    const fallback = jest.fn().mockResolvedValue(undefined);

    const result = await sendSurveyReassignmentNotifications({
      logPrefix: "Zuper Confirm",
      schedulerName: "Sarah Miller",
      schedulerEmail: "sarah@photonbrothers.com",
      previousSurveyor: baseCurrent,
      currentSurveyor: { ...baseCurrent, uid: null },
      currentRecipients: [{ email: "sam.paro@photonbrothers.com", name: "Sam Paro" }],
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      scheduledDate: "2026-03-16",
      projectId: "PROJ-1234",
      sendStandardSchedulingNotifications: fallback,
    });

    expect(result).toEqual({ mode: "standard" });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(mockSendReassignmentNotification).not.toHaveBeenCalled();
  });

  it("falls back to the standard scheduling notification when the new surveyor email is the scheduler fallback", async () => {
    const fallback = jest.fn().mockResolvedValue(undefined);

    const result = await sendSurveyReassignmentNotifications({
      logPrefix: "Zuper Schedule",
      schedulerName: "Sarah Miller",
      schedulerEmail: "sarah@photonbrothers.com",
      previousSurveyor: basePrevious,
      currentSurveyor: baseCurrent,
      currentRecipients: [{ email: "sarah@photonbrothers.com", name: "Sarah Miller" }],
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      scheduledDate: "2026-03-16",
      projectId: "PROJ-1234",
      usedSchedulerFallback: true,
      sendStandardSchedulingNotifications: fallback,
    });

    expect(result).toEqual({ mode: "standard" });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(mockSendReassignmentNotification).not.toHaveBeenCalled();
  });
});
