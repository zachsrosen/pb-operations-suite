import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBar } from "@/app/dashboards/map/FilterBar";

describe("FilterBar", () => {
  const defaultProps = {
    mode: "today" as const,
    types: ["install", "service"] as const,
    enabledTypes: ["install", "service"] as const,
    availableLocations: [] as const,
    enabledLocations: [] as const,
    availableAssignees: [] as const,
    enabledAssignees: [] as const,
    showUnassigned: true,
    meAssigneeId: null,
    onModeChange: jest.fn(),
    onTypeToggle: jest.fn(),
    onLocationToggle: jest.fn(),
    onLocationsReset: jest.fn(),
    onAssigneeToggle: jest.fn(),
    onToggleUnassigned: jest.fn(),
    onAssigneesReset: jest.fn(),
  };

  it("renders all three mode toggles with Today active", () => {
    render(<FilterBar {...defaultProps} />);
    const todayBtn = screen.getByRole("tab", { name: /today/i });
    expect(todayBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: /week/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onModeChange when any mode tab is clicked", () => {
    const onModeChange = jest.fn();
    render(<FilterBar {...defaultProps} onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /week/i }));
    expect(onModeChange).toHaveBeenCalledWith("week");
    fireEvent.click(screen.getByRole("tab", { name: /backlog/i }));
    expect(onModeChange).toHaveBeenCalledWith("backlog");
  });

  it("renders type chips and toggles via onTypeToggle", () => {
    const onTypeToggle = jest.fn();
    render(<FilterBar {...defaultProps} onTypeToggle={onTypeToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(onTypeToggle).toHaveBeenCalledWith("install");
  });

  it("shows assignee dropdown with crew members and 'Me' shortcut", () => {
    const onAssigneeToggle = jest.fn();
    render(
      <FilterBar
        {...defaultProps}
        availableAssignees={[
          { id: "user-1", label: "Alex P." },
          { id: "user-2", label: "Marco R." },
        ]}
        meAssigneeId="user-1"
        onAssigneeToggle={onAssigneeToggle}
      />
    );
    const btn = screen.getByRole("button", { name: /all crews/i });
    fireEvent.click(btn);
    // "Me" shortcut appears
    expect(screen.getByText(/^Me$/)).toBeInTheDocument();
    // Crew checkbox for Alex with a "you" marker
    const alexCheckbox = screen.getByRole("checkbox", { name: /alex p\./i });
    fireEvent.click(alexCheckbox);
    expect(onAssigneeToggle).toHaveBeenCalledWith("user-1");
  });

  it("shows the locations dropdown when locations are available", () => {
    const onLocationToggle = jest.fn();
    render(
      <FilterBar
        {...defaultProps}
        availableLocations={["DTC", "Westminster"] as const}
        onLocationToggle={onLocationToggle}
      />
    );
    const shopBtn = screen.getByRole("button", { name: /all shops/i });
    fireEvent.click(shopBtn);
    const dtcCheckbox = screen.getByRole("checkbox", { name: /dtc/i });
    fireEvent.click(dtcCheckbox);
    expect(onLocationToggle).toHaveBeenCalledWith("DTC");
  });
});
