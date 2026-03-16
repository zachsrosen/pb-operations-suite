import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockResendSend = jest.fn();
const mockResendConstructor = jest.fn(() => ({
  emails: {
    send: mockResendSend,
  },
}));

jest.mock("@react-email/render", () => ({
  render: jest.fn(async (element: React.ReactElement) => renderToStaticMarkup(element)),
}));

jest.mock("resend", () => ({
  Resend: mockResendConstructor,
}));

describe("sendReassignmentNotification", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: "test-resend-key",
      SCHEDULING_NOTIFICATION_BCC: "ops@photonbrothers.com",
    };
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.GOOGLE_EMAIL_SENDER;
    delete process.env.EMAIL_FROM;
    delete process.env.GOOGLE_ADMIN_EMAIL;
    mockResendSend.mockResolvedValue({ error: null });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("sends an incoming reassignment email with merged BCC recipients and calendar link", async () => {
    const { sendReassignmentNotification } = await import("@/lib/email");

    const result = await sendReassignmentNotification({
      to: "sam.paro@photonbrothers.com",
      crewMemberName: "Sam Paro",
      reassignedByName: "Sarah Miller",
      reassignedByEmail: "sarah@photonbrothers.com",
      otherSurveyorName: "Derek Thompson",
      direction: "incoming",
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
    });

    expect(result).toEqual({ success: true });
    expect(mockResendConstructor).toHaveBeenCalledWith("test-resend-key");
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["sam.paro@photonbrothers.com"],
        bcc: expect.arrayContaining(["ops@photonbrothers.com", "sarah@photonbrothers.com"]),
        subject: "Site Survey Reassigned - Williams, Robert",
        text: expect.stringContaining("Previously assigned to Derek Thompson"),
        html: expect.stringContaining("Open Google Calendar Event"),
      })
    );
  });

  it("omits the calendar link from outgoing reassignment emails", async () => {
    const { sendReassignmentNotification } = await import("@/lib/email");

    await sendReassignmentNotification({
      to: "derek@photonbrothers.com",
      crewMemberName: "Derek Thompson",
      reassignedByName: "Sarah Miller",
      reassignedByEmail: "sarah@photonbrothers.com",
      otherSurveyorName: "Sam Paro",
      direction: "outgoing",
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      scheduledDate: "2026-03-16",
      projectId: "PROJ-1234",
    });

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["derek@photonbrothers.com"],
        text: expect.not.stringContaining("Google Calendar Event"),
        html: expect.not.stringContaining("Open Google Calendar Event"),
      })
    );
  });
});
