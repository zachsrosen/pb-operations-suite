import { categorizeMessage } from "@/lib/comms-categorize";
import type { CommsMessage } from "@/lib/comms-gmail";

function makeMsg(overrides: Partial<CommsMessage>): CommsMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    source: "gmail",
    from: "Test User <test@example.com>",
    fromEmail: "test@example.com",
    to: "zach@photonbrothers.com",
    subject: "Hello",
    snippet: "Test message",
    date: new Date().toISOString(),
    isUnread: false,
    isStarred: false,
    labelIds: [],
    ...overrides,
  };
}

describe("categorizeMessage", () => {
  test("tags HubSpot notification emails as hubspot source", () => {
    const msg = makeMsg({ fromEmail: "notifications@hubspot.com" });
    const result = categorizeMessage(msg, "21710069");
    expect(result.source).toBe("hubspot");
  });

  test("detects deal stage change in subject", () => {
    const msg = makeMsg({
      fromEmail: "notifications@hubspot.com",
      subject: "Deal moved to Closed Won",
    });
    const result = categorizeMessage(msg, "21710069");
    expect(result.category).toBe("stage_change");
  });

  test("detects @mention in snippet", () => {
    const msg = makeMsg({
      fromEmail: "notifications@hubspot.com",
      snippet: "@Zach can you confirm the install date?",
    });
    const result = categorizeMessage(msg, "21710069");
    expect(result.category).toBe("mention");
  });

  test("extracts deal URL from HubSpot email", () => {
    const msg = makeMsg({
      fromEmail: "notifications@hubspot.com",
      snippet: "View deal: https://app.hubspot.com/contacts/21710069/deal/12345",
    });
    const result = categorizeMessage(msg, "21710069");
    expect(result.hubspotDealId).toBe("12345");
  });

  test("leaves non-HubSpot emails as gmail source", () => {
    const msg = makeMsg({ fromEmail: "friend@gmail.com" });
    const result = categorizeMessage(msg, "21710069");
    expect(result.source).toBe("gmail");
    expect(result.category).toBe("general");
  });
});
