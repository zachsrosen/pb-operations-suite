import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminBulkActionBar } from "@/components/admin-shell/AdminBulkActionBar";

describe("AdminBulkActionBar", () => {
  it("renders nothing when visible=false", () => {
    render(
      <AdminBulkActionBar visible={false} count={0} onCancel={() => {}}>
        <button>X</button>
      </AdminBulkActionBar>,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders count + children when visible=true", () => {
    render(
      <AdminBulkActionBar visible count={3} onCancel={() => {}}>
        <button>Delete selected</button>
      </AdminBulkActionBar>,
    );
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeInTheDocument();
  });

  it("calls onCancel on Cancel click", async () => {
    const user = userEvent.setup();
    const cancel = jest.fn();
    render(
      <AdminBulkActionBar visible count={1} onCancel={cancel}>
        <button>X</button>
      </AdminBulkActionBar>,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancel).toHaveBeenCalled();
  });

  it("uses role=region with aria-live=polite so count changes are announced", () => {
    render(
      <AdminBulkActionBar visible count={2} onCancel={() => {}}>
        <button>X</button>
      </AdminBulkActionBar>,
    );
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
