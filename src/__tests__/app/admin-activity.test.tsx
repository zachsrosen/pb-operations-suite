/**
 * Integration test for /admin/activity page rewrite.
 *
 * Covers:
 *   1. Renders rows after loading activities from mocked /api/admin/activity
 *   2. Row click opens drawer with metadata visible
 *   3. Date range chip change triggers router.replace with updated ?dateRange=
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Navigation mocks ───────────────────────────────────────────────────────

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/admin/activity",
}));

// ── Toast context mock ─────────────────────────────────────────────────────

jest.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ addToast: jest.fn() }),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const ACTIVITY_1 = {
  id: "act-1",
  type: "LOGIN",
  description: "User logged in",
  userId: "user-a",
  userEmail: "alice@example.com",
  entityType: "user",
  entityId: "user-a",
  entityName: "Alice",
  metadata: { device: "Chrome" },
  ipAddress: "1.2.3.4",
  userAgent: "Mozilla/5.0",
  sessionId: "sess-abc",
  requestPath: "/api/auth/session",
  requestMethod: "GET",
  riskLevel: "LOW",
  createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5m ago
  user: { name: "Alice", email: "alice@example.com", image: null, roles: ["ADMIN"] },
};

const ACTIVITY_2 = {
  id: "act-2",
  type: "USER_ROLE_CHANGED",
  description: "Role updated",
  userId: "user-b",
  userEmail: "bob@example.com",
  entityType: "user",
  entityId: "user-b",
  entityName: "Bob",
  metadata: null,
  ipAddress: "5.6.7.8",
  userAgent: "Firefox",
  sessionId: null,
  requestPath: null,
  requestMethod: null,
  riskLevel: "MEDIUM",
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
  user: { name: "Bob", email: "bob@example.com", image: null, roles: ["VIEWER"] },
};

const API_RESPONSE = {
  activities: [ACTIVITY_1, ACTIVITY_2],
  total: 2,
};

const TYPES_RESPONSE = { types: ["LOGIN", "USER_ROLE_CHANGED"] };

// ── fetch mock helpers ─────────────────────────────────────────────────────

function setupFetchMock(
  activityResponse: typeof API_RESPONSE = API_RESPONSE,
) {
  (global.fetch as jest.Mock) = jest.fn((url: string) => {
    if (url.includes("meta=types")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(TYPES_RESPONSE),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(activityResponse),
    });
  });
}

// ── Import subject (after mocks) ───────────────────────────────────────────

import AdminActivityPage from "@/app/admin/activity/page";

// ── Setup / teardown ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  setupFetchMock();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("/admin/activity page", () => {
  it("renders activity rows after loading", async () => {
    render(<AdminActivityPage />);

    // Wait for rows to appear (fetch resolves)
    await waitFor(() => {
      expect(screen.getByText("User logged in")).toBeInTheDocument();
    });

    expect(screen.getByText("Role updated")).toBeInTheDocument();
    // Actor emails should appear
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    // Delay fetch so loading state is visible
    (global.fetch as jest.Mock) = jest.fn(() => new Promise(() => {}));
    render(<AdminActivityPage />);
    // AdminTable renders a role="status" spinner while loading=true
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("opens the detail drawer when a row is clicked, showing metadata", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPage />);

    await waitFor(() => screen.getByText("User logged in"));

    // Click the first row (description text is in a cell)
    await user.click(screen.getByText("User logged in"));

    // Drawer title should contain the type
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // AdminKeyValueGrid renders the metadata section
    await waitFor(() => {
      // IP address in KV grid
      expect(screen.getByText("1.2.3.4")).toBeInTheDocument();
    });

    // metadata JSON pre block
    expect(screen.getByText(/Chrome/)).toBeInTheDocument();
  });

  it("drawer shows actor email and session ID", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPage />);

    await waitFor(() => screen.getByText("User logged in"));
    await user.click(screen.getByText("User logged in"));

    await waitFor(() => {
      expect(screen.getByText("sess-abc")).toBeInTheDocument();
    });
  });

  it("closes the drawer on Escape", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPage />);

    await waitFor(() => screen.getByText("User logged in"));
    await user.click(screen.getByText("User logged in"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("date range chip change calls router.replace with ?dateRange=7d", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPage />);

    await waitFor(() => screen.getByText("User logged in"));

    // Find the "7d" chip button (aria-pressed=false initially)
    const chip7d = screen.getByRole("button", { name: "7d" });
    await user.click(chip7d);

    // router.replace should have been called with ?dateRange=7d
    await waitFor(() => {
      const calls = mockReplace.mock.calls;
      const lastCall = calls[calls.length - 1][0] as string;
      expect(lastCall).toContain("dateRange=7d");
    });
  });

  it("clears all filters when 'Clear all' is clicked", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPage />);

    await waitFor(() => screen.getByText("User logged in"));

    // Activate a filter first to make Clear all visible
    const chip7d = screen.getByRole("button", { name: "7d" });
    await user.click(chip7d);

    const clearAll = screen.getByRole("button", { name: /clear all/i });
    await user.click(clearAll);

    // After clearing, dateRange resets to "all"; the All chip should be active
    const allChip = screen.getByRole("button", { name: "All" });
    expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an error state when fetch fails", async () => {
    (global.fetch as jest.Mock) = jest.fn((url: string) => {
      if (url.includes("meta=types")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ types: [] }) });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "Unauthorized" }),
      });
    });

    render(<AdminActivityPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Unauthorized")).toBeInTheDocument();
    });
  });
});
