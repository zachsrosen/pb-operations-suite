import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";

describe("AdminDetailDrawer", () => {
  it("renders children when open", () => {
    render(
      <AdminDetailDrawer open onClose={() => {}} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    expect(screen.getByText("BODY")).toBeInTheDocument();
  });

  it("does not render children when closed", () => {
    render(
      <AdminDetailDrawer open={false} onClose={() => {}} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    expect(screen.queryByText("BODY")).not.toBeInTheDocument();
  });

  it("calls onClose when Esc pressed", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <AdminDetailDrawer open onClose={onClose} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("traps focus: Tab from last element cycles to first", async () => {
    const user = userEvent.setup();
    render(
      <AdminDetailDrawer open onClose={() => {}} title="T">
        <button>A</button>
        <button>B</button>
      </AdminDetailDrawer>,
    );
    // Close button is the first focusable; B is last
    const b = screen.getByRole("button", { name: "B" });
    b.focus();
    await user.tab();
    // Tab from last should land back on the close button
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /close/i }));
  });

  it("calls onClose on outside click", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <AdminDetailDrawer open onClose={onClose} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    // Overlay is the element with data-admin-drawer-overlay
    const overlay = document.querySelector('[data-admin-drawer-overlay="true"]') as HTMLElement;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("exposes aria-labelledby pointing at the title element", () => {
    render(
      <AdminDetailDrawer open onClose={() => {}} title={<span>TITLE</span>}>
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    const dialog = screen.getByRole("dialog");
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)).toHaveTextContent("TITLE");
  });

  it("renders a close button with accessible label", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <AdminDetailDrawer open onClose={onClose} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
