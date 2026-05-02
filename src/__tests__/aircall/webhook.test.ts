import crypto from "node:crypto";

import { idempotencyKeyFor, mapCallToCacheRow, verifyAircallSignature } from "@/lib/aircall-webhook";
import type { AircallCall } from "@/lib/aircall";

describe("verifyAircallSignature", () => {
  const SECRET = "shhh-its-a-secret";

  function sign(body: string) {
    return crypto.createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
  }

  test("accepts a correctly-signed body", () => {
    const body = JSON.stringify({ event: "call.ended" });
    expect(verifyAircallSignature(body, sign(body), SECRET)).toBe(true);
  });

  test("rejects when the body has been altered", () => {
    const body = JSON.stringify({ event: "call.ended" });
    const sig = sign(body);
    expect(verifyAircallSignature(body + " ", sig, SECRET)).toBe(false);
  });

  test("rejects empty/missing signature", () => {
    const body = "{}";
    expect(verifyAircallSignature(body, "", SECRET)).toBe(false);
    expect(verifyAircallSignature(body, null, SECRET)).toBe(false);
    expect(verifyAircallSignature(body, undefined, SECRET)).toBe(false);
  });

  test("rejects signature when secret is empty", () => {
    expect(verifyAircallSignature("{}", "deadbeef", "")).toBe(false);
  });

  test("rejects malformed hex signature", () => {
    expect(verifyAircallSignature("{}", "not-hex!!", SECRET)).toBe(false);
  });

  test("constant-time: signature of different length returns false fast", () => {
    expect(verifyAircallSignature("{}", "ab", SECRET)).toBe(false);
  });
});

describe("idempotencyKeyFor", () => {
  test("uses event_id when present", () => {
    expect(idempotencyKeyFor({ event: "call.ended", event_id: "evt-123" })).toBe("aircall:evt-123");
  });

  test("falls back to (event, call id, timestamp) when event_id is missing", () => {
    const key = idempotencyKeyFor({
      event: "call.ended",
      timestamp: 123,
      data: { id: 42 } as unknown as AircallCall,
    });
    expect(key).toBe("aircall:call.ended:42:123");
  });
});

describe("mapCallToCacheRow", () => {
  const baseCall: AircallCall = {
    id: 9001,
    direction: "inbound",
    status: "done",
    started_at: 1_700_000_000, // 2023-11-14T22:13:20Z
    answered_at: 1_700_000_010, // +10s
    ended_at: 1_700_000_130, // +130s total
    duration: 130,
    user: { id: 1, name: "Alice", email: "alice@example.com" },
    raw_digits: "+13035551234",
  };

  test("answered call computes talk_time and time_to_answer", () => {
    const row = mapCallToCacheRow(baseCall);
    expect(row.id).toBe("9001");
    expect(row.status).toBe("answered");
    expect(row.talkTimeSec).toBe(120);
    expect(row.timeToAnswerSec).toBe(10);
    expect(row.durationSec).toBe(130);
    expect(row.userAircallId).toBe("1");
    expect(row.userName).toBe("Alice");
    expect(row.customerNumber).toBe("+13035551234");
  });

  test("missed call has null timeToAnswerSec and zero talk time", () => {
    const row = mapCallToCacheRow({
      ...baseCall,
      answered_at: null,
      ended_at: null,
      duration: 0,
    });
    expect(row.status).toBe("missed");
    expect(row.timeToAnswerSec).toBeNull();
    expect(row.talkTimeSec).toBe(0);
  });

  test("voicemail status is detected when voicemail url present", () => {
    const row = mapCallToCacheRow({
      ...baseCall,
      answered_at: null,
      voicemail: "https://example.com/voicemail.mp3",
    });
    expect(row.status).toBe("voicemail");
  });

  test("startedAt converts unix seconds to JS Date", () => {
    const row = mapCallToCacheRow(baseCall);
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.startedAt.getTime()).toBe(1_700_000_000_000);
  });
});
