jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminSearch } from "@/components/admin-shell/AdminSearch";

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      users: [{ id: "u1", email: "nick@x.com", name: "Nick" }],
      roles: [{ role: "ADMIN", label: "Administrator" }],
      activity: [],
      tickets: [],
    }),
  });
});

describe("AdminSearch", () => {
  it("renders with aria combobox role", () => {
    render(<AdminSearch />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("debounces input and queries /api/admin/search", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(
      () => expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/search?q=nick"),
        expect.anything(),
      ),
      { timeout: 500 },
    );
  });

  it("renders results in a listbox", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    expect(screen.getByText("nick@x.com")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("closes the dropdown on Escape", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves aria-activedescendant on ArrowDown", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    await user.keyboard("{ArrowDown}");
    const combobox = screen.getByRole("combobox");
    expect(combobox.getAttribute("aria-activedescendant")).toBeTruthy();
  });
});
