import { render, screen } from "@testing-library/react";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";

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
