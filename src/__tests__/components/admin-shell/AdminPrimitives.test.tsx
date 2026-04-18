import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminLoading } from "@/components/admin-shell/AdminLoading";
import { AdminError } from "@/components/admin-shell/AdminError";

describe("AdminEmpty", () => {
  it("renders label + description", () => {
    render(<AdminEmpty label="No users" description="Try changing filters" />);
    expect(screen.getByText("No users")).toBeInTheDocument();
    expect(screen.getByText("Try changing filters")).toBeInTheDocument();
  });

  it("renders an optional action node", () => {
    render(
      <AdminEmpty
        label="No users"
        action={<button>Invite user</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Invite user" })).toBeInTheDocument();
  });
});

describe("AdminLoading", () => {
  it("renders optional label", () => {
    render(<AdminLoading label="Loading users…" />);
    expect(screen.getByText("Loading users…")).toBeInTheDocument();
  });

  it("sets role='status' for screen readers", () => {
    render(<AdminLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("AdminError", () => {
  it("renders error message", () => {
    render(<AdminError error="Database unreachable" />);
    expect(screen.getByText("Database unreachable")).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<AdminError error="Failed" onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
