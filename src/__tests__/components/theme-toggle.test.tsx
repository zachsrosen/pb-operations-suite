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

  it("renders moon icon in dark mode", () => {
    mockUseTheme.mockReturnValue({
      theme: "dark",
      toggleTheme: jest.fn(),
    });

    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Dark mode" });

    expect(button).toHaveAttribute("title", "Dark mode");
    expect(button).toHaveAttribute("aria-label", "Dark mode");
  });

  it("renders sun icon in light mode", () => {
    mockUseTheme.mockReturnValue({
      theme: "light",
      toggleTheme: jest.fn(),
    });

    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Light mode" })).toBeInTheDocument();
  });

  it("renders sunset icon in sunset mode", () => {
    mockUseTheme.mockReturnValue({
      theme: "sunset",
      toggleTheme: jest.fn(),
    });

    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Sunset mode" })).toBeInTheDocument();
  });

  it("calls toggleTheme on click", () => {
    const toggleTheme = jest.fn();
    mockUseTheme.mockReturnValue({
      theme: "light",
      toggleTheme,
    });

    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Light mode" }));

    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});
