import { postEndOfSessionNote } from "@/lib/shit-show/hubspot-note";

jest.mock("@/lib/db", () => ({
  prisma: {
    shitShowSessionItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

const mockFetch = jest.fn();
(global as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

import { prisma } from "@/lib/db";

const mockFind = prisma.shitShowSessionItem.findUnique as jest.Mock;
const mockUpdate = prisma.shitShowSessionItem.update as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.HUBSPOT_ACCESS_TOKEN = "tok";
});

describe("postEndOfSessionNote", () => {
  it("posts a note and stores hubspotNoteId", async () => {
    mockFind.mockResolvedValue({
      id: "i1",
      dealId: "d1",
      session: { date: new Date("2026-04-27") },
      decision: "RESOLVED",
      decisionRationale: "fixed",
      reasonSnapshot: "was broken",
      meetingNotes: "talked it through",
      assignments: [],
      hubspotNoteId: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "note-99" }),
    });
    mockUpdate.mockResolvedValue({});

    const result = await postEndOfSessionNote("i1");
    expect(result.noteId).toBe("note-99");
    expect(result.status).toBe("SYNCED");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hubspotNoteId: "note-99",
          noteSyncStatus: "SYNCED",
        }),
      }),
    );
  });

  it("is idempotent — skips when hubspotNoteId already set", async () => {
    mockFind.mockResolvedValue({
      id: "i1",
      hubspotNoteId: "note-99",
      assignments: [],
      session: { date: new Date() },
      decision: "RESOLVED",
    });
    const result = await postEndOfSessionNote("i1");
    expect(result.status).toBe("SKIPPED");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("records FAILED status on HubSpot error", async () => {
    mockFind.mockResolvedValue({
      id: "i1",
      dealId: "d1",
      session: { date: new Date("2026-04-27") },
      decision: "RESOLVED",
      decisionRationale: null,
      reasonSnapshot: null,
      meetingNotes: null,
      assignments: [],
      hubspotNoteId: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    mockUpdate.mockResolvedValue({});

    const result = await postEndOfSessionNote("i1");
    expect(result.status).toBe("FAILED");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ noteSyncStatus: "FAILED" }),
      }),
    );
  });

  it("formats body with assignments list when present", async () => {
    mockFind.mockResolvedValue({
      id: "i1",
      dealId: "d1",
      session: { date: new Date("2026-04-27") },
      decision: "STILL_PROBLEM",
      decisionRationale: "design redo",
      reasonSnapshot: "wrong layout",
      meetingNotes: "discuss",
      assignments: [
        { assigneeUserId: "user-x", actionText: "redraw layout", dueDate: new Date("2026-05-01") },
      ],
      hubspotNoteId: null,
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "note-100" }) });
    mockUpdate.mockResolvedValue({});

    await postEndOfSessionNote("i1");

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const noteBody = sentBody.properties.hs_note_body as string;
    expect(noteBody).toContain("Decision: Still a problem");
    expect(noteBody).toContain("Decision rationale: design redo");
    expect(noteBody).toContain("- user-x: redraw layout (due 2026-05-01)");
  });
});
