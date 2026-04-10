import {
  OFFICE_DAILY_SURVEY_CAPS,
  applyOfficeDailyCap,
  type DayForOfficeCap,
} from "@/lib/scheduling-policy";

function makeDay(available: number, booked: number): DayForOfficeCap {
  return {
    availableSlots: Array(available).fill({}),
    bookedSlots: Array(booked).fill({}),
    hasAvailability: available > 0,
  };
}

describe("OFFICE_DAILY_SURVEY_CAPS config", () => {
  it("is a plain object", () => {
    expect(typeof OFFICE_DAILY_SURVEY_CAPS).toBe("object");
    expect(OFFICE_DAILY_SURVEY_CAPS).not.toBeNull();
    expect(Array.isArray(OFFICE_DAILY_SURVEY_CAPS)).toBe(false);
  });

  it("DTC cap is 3", () => {
    expect(OFFICE_DAILY_SURVEY_CAPS.DTC).toBe(3);
  });

  it("Westminster cap is 3", () => {
    expect(OFFICE_DAILY_SURVEY_CAPS.Westminster).toBe(3);
  });
});

describe("applyOfficeDailyCap", () => {
  it("DTC under cap: 2 booked + 4 available → not capped", () => {
    const day = makeDay(4, 2);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(false);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots.length).toBe(4);
    expect(day.bookedSlots!.length).toBe(2);
    expect(day.hasAvailability).toBe(true);
  });

  it("DTC at cap: 3 booked + 3 available → capped", () => {
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(true);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots.length).toBe(0);
    expect(day.bookedSlots!.length).toBe(3);
    expect(day.hasAvailability).toBe(false);
  });

  it("DTC over cap: 4 booked + 2 available (force-booked) → capped", () => {
    const day = makeDay(2, 4);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(true);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots.length).toBe(0);
    expect(day.bookedSlots!.length).toBe(4);
    expect(day.hasAvailability).toBe(false);
  });

  it("Colorado Springs (unconfigured): 3 booked + 3 available → no cap fields", () => {
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, "Colorado Springs");
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    expect(day.availableSlots.length).toBe(3);
    expect(day.hasAvailability).toBe(true);
  });

  it("Westminster under cap: 0 booked + 6 available → not capped", () => {
    const day = makeDay(6, 0);
    applyOfficeDailyCap(day, "Westminster");
    expect(day.dayCapped).toBe(false);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots.length).toBe(6);
    expect(day.hasAvailability).toBe(true);
  });

  it("unknown office (FakeOffice) → returns early, day untouched", () => {
    const day = makeDay(3, 1);
    applyOfficeDailyCap(day, "FakeOffice");
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    expect(day.availableSlots.length).toBe(3);
    expect(day.hasAvailability).toBe(true);
  });

  it("DTC at cap with 0 available (idempotency): 3 booked + 0 available → capped", () => {
    const day = makeDay(0, 3);
    applyOfficeDailyCap(day, "DTC");
    expect(day.dayCapped).toBe(true);
    expect(day.capLimit).toBe(3);
    expect(day.availableSlots.length).toBe(0);
    expect(day.hasAvailability).toBe(false);
  });

  it("office undefined → returns early, day untouched", () => {
    const day = makeDay(5, 2);
    applyOfficeDailyCap(day, undefined);
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    expect(day.availableSlots.length).toBe(5);
    expect(day.hasAvailability).toBe(true);
  });

  it("Centennial (alias for DTC) at cap: 3 booked → should still be capped when resolved to DTC", () => {
    // This test verifies that the route-level alias resolution is needed.
    // applyOfficeDailyCap itself doesn't know about aliases — it receives
    // the resolved office name from the route. Calling it with "Centennial"
    // directly should NOT apply the cap (it's not in the caps map).
    const day = makeDay(3, 3);
    applyOfficeDailyCap(day, "Centennial");
    expect(day.dayCapped).toBeUndefined();
    expect(day.capLimit).toBeUndefined();
    // But calling with "DTC" (what the route resolves to) DOES apply the cap.
    const day2 = makeDay(3, 3);
    applyOfficeDailyCap(day2, "DTC");
    expect(day2.dayCapped).toBe(true);
    expect(day2.capLimit).toBe(3);
    expect(day2.availableSlots.length).toBe(0);
  });
});
