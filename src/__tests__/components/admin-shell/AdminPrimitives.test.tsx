import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminLoading } from "@/components/admin-shell/AdminLoading";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminBreadcrumb } from "@/components/admin-shell/AdminBreadcrumb";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";

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

describe("AdminBreadcrumb", () => {
  it("renders segments separated by slashes", () => {
    render(<AdminBreadcrumb segments={["Admin", "People", "Users"]} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getAllByText("/")).toHaveLength(2);
  });
});

describe("AdminPageHeader", () => {
  it("renders title + breadcrumb + actions", () => {
    render(
      <AdminPageHeader
        title="Role Inspector"
        breadcrumb={["Admin", "People", "Roles"]}
        actions={<button>New role</button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Role Inspector" })).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New role" })).toBeInTheDocument();
  });
});
