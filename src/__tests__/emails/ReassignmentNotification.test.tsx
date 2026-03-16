import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReassignmentNotification, type ReassignmentNotificationProps } from "@/emails/ReassignmentNotification";

const baseProps: ReassignmentNotificationProps = {
  crewMemberName: "Derek Thompson",
  reassignedByName: "Sarah Miller",
  otherSurveyorName: "Sam Paro",
  direction: "outgoing",
  customerName: "Williams, Robert",
  customerAddress: "1234 Solar Lane, Denver, CO 80202",
  formattedDate: "Monday, March 16, 2026",
  timeSlot: "9:00 AM - 10:00 AM",
  dealOwnerName: "Mike Chen",
  notes: "Gate code 2468. Call on arrival.",
  hubSpotDealUrl: "https://app.hubspot.com/contacts/123/record/0-3/456",
  zuperJobUrl: "https://app.zuperpro.com/jobs/789",
  googleCalendarEventUrl: "https://calendar.google.com/event?eid=123",
};

describe("ReassignmentNotification", () => {
  it("renders the outgoing reassignment context and excludes the calendar link", async () => {
    const html = renderToStaticMarkup(
      React.createElement(ReassignmentNotification, {
        ...baseProps,
        direction: "outgoing",
      })
    );

    expect(html).toContain("SITE SURVEY REASSIGNED");
    expect(html).toContain("Now assigned to Sam Paro");
    expect(html).toContain("Reassigned by");
    expect(html).toContain("Open HubSpot Deal");
    expect(html).toContain("Open Zuper Job");
    expect(html).not.toContain("Open Google Calendar Event");
    expect(html).toContain("Site Survey Reassigned - Williams, Robert");
  });

  it("renders the incoming reassignment context and includes the calendar link", async () => {
    const html = renderToStaticMarkup(
      React.createElement(ReassignmentNotification, {
        ...baseProps,
        direction: "incoming",
        otherSurveyorName: "Derek Thompson",
      })
    );

    expect(html).toContain("Previously assigned to Derek Thompson");
    expect(html).toContain("Open Google Calendar Event");
    expect(html).toContain("Gate code 2468. Call on arrival.");
  });
});
