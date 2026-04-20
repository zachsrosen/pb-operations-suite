import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";

interface Row { id: string; name: string; age: number }
const ROWS: Row[] = [
  { id: "1", name: "Alice", age: 30 },
  { id: "2", name: "Bob", age: 24 },
];
const COLS: AdminTableColumn<Row>[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "age", label: "Age", sortable: true, align: "right" },
];

describe("AdminTable", () => {
  it("renders rows and columns", () => {
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders empty slot when rows is empty", () => {
    render(
      <AdminTable rows={[]} rowKey={(r) => r.id} columns={COLS} caption="People" empty={<div>NO RESULTS</div>} />,
    );
    expect(screen.getByText("NO RESULTS")).toBeInTheDocument();
  });

  it("renders loading slot instead of rows when loading=true", () => {
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" loading />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument(); // internal spinner
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("renders error slot instead of rows when error is provided", () => {
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" error={<div>BOOM</div>} />,
    );
    expect(screen.getByText("BOOM")).toBeInTheDocument();
  });

  it("calls onRowClick with the row when a row is clicked", async () => {
    const user = userEvent.setup();
    const handler = jest.fn();
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" onRowClick={handler} />,
    );
    await user.click(screen.getByText("Alice"));
    expect(handler).toHaveBeenCalledWith(ROWS[0]);
  });

  it("toggles select on checkbox click when selection is enabled", async () => {
    const user = userEvent.setup();
    const toggle = jest.fn();
    render(
      <AdminTable
        rows={ROWS}
        rowKey={(r) => r.id}
        columns={COLS}
        caption="People"
        selectedIds={new Set()}
        onToggleSelect={toggle}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox is the select-all header; second is row 1
    await user.click(checkboxes[1]);
    expect(toggle).toHaveBeenCalledWith("1");
  });

  it("emits sortChange when a sortable column header is clicked", async () => {
    const user = userEvent.setup();
    const onSortChange = jest.fn();
    render(
      <AdminTable
        rows={ROWS}
        rowKey={(r) => r.id}
        columns={COLS}
        caption="People"
        sortBy={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /name/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", dir: "desc" }); // toggle direction
  });

  it("keyboard nav: ArrowDown moves focus to next row; Enter triggers onRowClick", async () => {
    const user = userEvent.setup();
    const handler = jest.fn();
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" onRowClick={handler} />,
    );
    const firstRow = screen.getAllByRole("row")[1]; // 0 is the header
    firstRow.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByRole("row")[2]);
    await user.keyboard("{Enter}");
    expect(handler).toHaveBeenCalledWith(ROWS[1]);
  });
});
