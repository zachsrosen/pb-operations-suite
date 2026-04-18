// src/__tests__/components/admin-shell/AdminShell.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminShell } from "@/components/admin-shell/AdminShell";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));
const { usePathname } = jest.requireMock("next/navigation");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width: 1280"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

describe("AdminShell", () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockReturnValue("/admin/users");
  });

  it("renders children", () => {
    render(
      <AdminShell>
        <div>PAGE BODY</div>
      </AdminShell>,
    );
    expect(screen.getByText("PAGE BODY")).toBeInTheDocument();
  });

  it("marks the matching sidebar link as active", () => {
    render(
      <AdminShell>
        <div />
      </AdminShell>,
    );
    const activeLink = screen.getByRole("link", { name: /Users/ });
    expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  it("toggles sidebar collapse when the toggle button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <AdminShell>
        <div />
      </AdminShell>,
    );
    const toggle = screen.getByRole("button", { name: /collapse sidebar/i });
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });
});
