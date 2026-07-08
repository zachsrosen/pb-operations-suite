/**
 * Portal survey page — slot-conflict (409 slotTaken) recovery.
 *
 * When the booking API blocks a double-book (guard added alongside
 * PR #1337), the customer must NOT land on the terminal error page: the
 * picker re-renders with fresh availability and a friendly notice so they
 * can pick another time.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Navigation mocks ─────────────────────────────────────────────────────────
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ token: "tok-1" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
}));

import SurveySchedulePage from "@/app/portal/survey/[token]/page";

// ── Fixtures ─────────────────────────────────────────────────────────────────
function pendingData(slots: Array<{ slotId: string; time: string; displayTime: string }>) {
  return {
    status: "pending",
    customerName: "Crane, Sarah",
    propertyAddress: "123 Main St",
    pbLocation: "DTC",
    availability: {
      days: [{ date: "2099-01-15", dayLabel: "Thu, Jan 15", slots }],
      timezone: "America/Denver",
      tzAbbrev: "MT",
    },
  };
}

const initialSlots = [{ slotId: "slot-10", time: "10:00", displayTime: "10:00 AM" }];
const refreshedSlots = [{ slotId: "slot-11", time: "11:00", displayTime: "11:00 AM" }];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "3f8a2c44-9c1d-4f6e-8a3b-2d5e7f9a1b0c" },
      configurable: true,
    });
  }
});

it("re-renders the slot picker with fresh availability when the slot was just taken", async () => {
  const fetchMock = jest
    .fn()
    // 1. initial invite load
    .mockResolvedValueOnce(jsonResponse(pendingData(initialSlots)))
    // 2. booking attempt → guard 409
    .mockResolvedValueOnce(
      jsonResponse(
        { error: "This time slot is no longer available. Please choose another time.", slotTaken: true },
        409,
      ),
    )
    // 3. availability refresh
    .mockResolvedValueOnce(jsonResponse(pendingData(refreshedSlots)));
  global.fetch = fetchMock as unknown as typeof fetch;

  const user = userEvent.setup();
  render(<SurveySchedulePage />);

  // Pick the only slot and confirm
  await user.click(await screen.findByRole("button", { name: "10:00 AM" }));
  await user.click(screen.getByRole("button", { name: /confirm survey/i }));

  // Friendly notice — not the terminal error page
  await waitFor(() => {
    expect(screen.getByText(/no longer available/i)).toBeTruthy();
  });
  expect(screen.queryByRole("heading", { name: /something went wrong/i })).toBeNull();

  // Picker re-rendered with fresh availability
  expect(await screen.findByRole("button", { name: "11:00 AM" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "10:00 AM" })).toBeNull();

  // Availability was actually refetched from the invite endpoint
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[2][0]).toBe("/api/portal/survey/tok-1");

  // No navigation to the confirmation page happened
  expect(mockPush).not.toHaveBeenCalled();
});

it("still shows the terminal error page on non-conflict failures", async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(jsonResponse(pendingData(initialSlots)))
    .mockResolvedValueOnce(jsonResponse({ error: "Something went wrong. Please try again." }, 500));
  global.fetch = fetchMock as unknown as typeof fetch;

  const user = userEvent.setup();
  render(<SurveySchedulePage />);

  await user.click(await screen.findByRole("button", { name: "10:00 AM" }));
  await user.click(screen.getByRole("button", { name: /confirm survey/i }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeTruthy();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
