import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AdminFilterBar,
  DateRangeChip,
  FilterChip,
  FilterSearch,
} from "@/components/admin-shell/AdminFilterBar";

describe("AdminFilterBar", () => {
  it("renders children", () => {
    render(
      <AdminFilterBar>
        <span>CHILD</span>
      </AdminFilterBar>,
    );
    expect(screen.getByText("CHILD")).toBeInTheDocument();
  });

  it("renders 'Clear all' button when hasActiveFilters is true", async () => {
    const user = userEvent.setup();
    const clear = jest.fn();
    render(
      <AdminFilterBar hasActiveFilters onClearAll={clear}>
        <span />
      </AdminFilterBar>,
    );
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    expect(clear).toHaveBeenCalled();
  });

  it("hides 'Clear all' when hasActiveFilters is false", () => {
    render(
      <AdminFilterBar onClearAll={() => {}}>
        <span />
      </AdminFilterBar>,
    );
    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
  });
});

describe("DateRangeChip", () => {
  const opts = [
    { value: "today", label: "Today" },
    { value: "7d", label: "7d" },
    { value: "all", label: "All" },
  ];

  it("marks selected option with aria-pressed=true", () => {
    render(<DateRangeChip selected="7d" options={opts} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with the new value when another option is clicked", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<DateRangeChip selected="7d" options={opts} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});

describe("FilterChip", () => {
  it("toggles aria-pressed based on active prop", () => {
    const { rerender } = render(<FilterChip active={false} onClick={() => {}}>Test</FilterChip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<FilterChip active onClick={() => {}}>Test</FilterChip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("FilterSearch", () => {
  it("debounces input via props — just passes through change events for now", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FilterSearch value="" onChange={onChange} placeholder="Search" />);
    await user.type(screen.getByPlaceholderText("Search"), "abc");
    expect(onChange).toHaveBeenCalledTimes(3); // a, b, c — page controls debounce
  });
});
