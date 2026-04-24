import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "@/app/dashboards/map/FilterBar";

describe("FilterBar", () => {
  const defaultProps = {
    mode: "today" as const,
    types: ["install", "service"] as const,
    enabledTypes: ["install", "service"] as const,
    onModeChange: jest.fn(),
    onTypeToggle: jest.fn(),
  };

  it("renders all three mode toggles with Today active", () => {
    render(<FilterBar {...defaultProps} />);
    const todayBtn = screen.getByRole("tab", { name: /today/i });
    expect(todayBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: /week/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onModeChange when the enabled Today tab is clicked", () => {
    const onModeChange = jest.fn();
    render(<FilterBar {...defaultProps} mode={"today"} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /today/i }));
    expect(onModeChange).toHaveBeenCalledWith("today");
  });

  it("disables Week and Backlog tabs in Phase 1", () => {
    const onModeChange = jest.fn();
    render(<FilterBar {...defaultProps} onModeChange={onModeChange} />);
    const weekBtn = screen.getByRole("tab", { name: /week/i });
    const backlogBtn = screen.getByRole("tab", { name: /backlog/i });
    expect(weekBtn).toBeDisabled();
    expect(backlogBtn).toBeDisabled();
    fireEvent.click(weekBtn);
    fireEvent.click(backlogBtn);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("renders type chips and toggles via onTypeToggle", () => {
    const onTypeToggle = jest.fn();
    render(<FilterBar {...defaultProps} onTypeToggle={onTypeToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(onTypeToggle).toHaveBeenCalledWith("install");
  });
});
