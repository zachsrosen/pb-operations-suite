import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/contexts/ThemeContext";

jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: jest.fn(),
}));

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

describe("ThemeToggle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders hydration-stable button metadata", () => {
    mockUseTheme.mockReturnValue({
      theme: "dark",
      toggleTheme: jest.fn(),
    });

    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Toggle theme" });

    expect(button).toHaveAttribute("title", "Toggle theme");
    expect(button).toHaveAttribute("aria-label", "Toggle theme");
  });

  it("calls toggleTheme on click", () => {
    const toggleTheme = jest.fn();
    mockUseTheme.mockReturnValue({
      theme: "light",
      toggleTheme,
    });

    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});
