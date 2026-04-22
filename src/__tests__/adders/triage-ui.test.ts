/**
 * @jest-environment jsdom
 *
 * Unit tests for pure helpers in the triage UI. Covers:
 * - Draft persistence round-trips (localStorage read/write/clear)
 * - Image compression fallback behavior (no-bitmap env just returns original)
 */

import {
  readDraft,
  writeDraft,
  clearDraft,
} from "@/app/triage/useOfflineDraft";
import { compressImage } from "@/app/triage/TriagePhotoCapture";

describe("useOfflineDraft persistence", () => {
  const runId = "run-abc";
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("readDraft returns null when nothing stored", () => {
    expect(readDraft(runId)).toBeNull();
  });

  test("writeDraft → readDraft round-trips fields", () => {
    writeDraft(runId, {
      answers: { "adder-1": true, "adder-2": 12 },
      stepIndex: 3,
      uncheckedReasons: { FOO: "doesn't apply" },
      uncheckedCodes: ["FOO"],
      savedAt: "2026-04-22T00:00:00.000Z",
    });
    const got = readDraft(runId);
    expect(got?.answers).toEqual({ "adder-1": true, "adder-2": 12 });
    expect(got?.stepIndex).toBe(3);
    expect(got?.uncheckedReasons).toEqual({ FOO: "doesn't apply" });
    expect(got?.uncheckedCodes).toEqual(["FOO"]);
  });

  test("clearDraft wipes the stored value", () => {
    writeDraft(runId, {
      answers: { x: 1 },
      stepIndex: 0,
      uncheckedReasons: {},
      uncheckedCodes: [],
      savedAt: "2026-04-22T00:00:00.000Z",
    });
    expect(readDraft(runId)).not.toBeNull();
    clearDraft(runId);
    expect(readDraft(runId)).toBeNull();
  });

  test("readDraft is tolerant of corrupted JSON", () => {
    window.localStorage.setItem(`triage-draft-${runId}`, "{not json");
    expect(readDraft(runId)).toBeNull();
  });

  test("readDraft coerces malformed fields to safe defaults", () => {
    window.localStorage.setItem(
      `triage-draft-${runId}`,
      JSON.stringify({
        answers: "not-an-object",
        stepIndex: "NaN",
        uncheckedReasons: null,
        uncheckedCodes: "not-an-array",
      })
    );
    const got = readDraft(runId);
    expect(got).not.toBeNull();
    expect(got!.answers).toEqual({});
    expect(got!.stepIndex).toBe(0);
    expect(got!.uncheckedReasons).toEqual({});
    expect(got!.uncheckedCodes).toEqual([]);
  });
});

describe("compressImage fallback", () => {
  test("returns the original file when createImageBitmap is unavailable", async () => {
    // jsdom doesn't implement createImageBitmap — compressImage should fall
    // back to returning the original file rather than throwing.
    const f = new File([new Uint8Array([1, 2, 3])], "photo.png", {
      type: "image/png",
    });
    const out = await compressImage(f);
    expect(out).toBe(f);
  });
});
