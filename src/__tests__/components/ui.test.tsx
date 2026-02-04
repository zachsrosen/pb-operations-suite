/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { StatCard, MiniStat, MetricCard, SummaryCard } from "@/components/ui/MetricCard";

describe("LoadingSpinner", () => {
  it("renders with default message", () => {
    render(<LoadingSpinner />);
    // Should render without crashing
    expect(document.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders with custom message", () => {
    render(<LoadingSpinner message="Loading data..." />);
    expect(screen.getByText("Loading data...")).toBeTruthy();
  });

  it("renders in different sizes", () => {
    const { rerender } = render(<LoadingSpinner size="sm" />);
    expect(document.querySelector(".h-6")).toBeTruthy();

    rerender(<LoadingSpinner size="lg" />);
    expect(document.querySelector(".h-16")).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("renders error message", () => {
    render(<ErrorState message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("renders retry button when onRetry is provided", () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);
    const button = screen.getByText("Retry");
    expect(button).toBeTruthy();
  });

  it("calls onRetry when retry button is clicked", () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);
    screen.getByText("Retry").click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render retry button when onRetry is not provided", () => {
    render(<ErrorState message="Error" />);
    expect(screen.queryByText("Retry")).toBeNull();
  });
});

describe("LiveIndicator", () => {
  it("renders with connected state by default", () => {
    render(<LiveIndicator />);
    // Should render a green indicator
    const indicator = document.querySelector(".bg-green-500");
    expect(indicator).toBeTruthy();
  });

  it("renders reconnecting state", () => {
    render(<LiveIndicator connected={false} reconnecting={true} />);
    const indicator = document.querySelector(".bg-yellow-500");
    expect(indicator).toBeTruthy();
  });

  it("renders offline state", () => {
    render(<LiveIndicator connected={false} reconnecting={false} />);
    const indicator = document.querySelector(".bg-zinc-500");
    expect(indicator).toBeTruthy();
  });

  it("renders custom label", () => {
    render(<LiveIndicator label="Live Data" />);
    expect(screen.getByText("Live Data")).toBeTruthy();
  });
});

describe("StatCard", () => {
  it("renders value and label", () => {
    render(<StatCard value="42" label="Total Projects" color="text-blue-400" />);
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Total Projects")).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    render(<StatCard value="42" label="Total" subtitle="$1.5M" color="text-green-400" />);
    expect(screen.getByText("$1.5M")).toBeTruthy();
  });
});

describe("MiniStat", () => {
  it("renders value and label", () => {
    render(<MiniStat value="15" label="Blocked" />);
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
  });
});

describe("MetricCard", () => {
  it("renders label, value, and sub", () => {
    render(<MetricCard label="Pipeline" value="$5.2M" sub="210 projects" />);
    expect(screen.getByText("Pipeline")).toBeTruthy();
    expect(screen.getByText("$5.2M")).toBeTruthy();
    expect(screen.getByText("210 projects")).toBeTruthy();
  });

  it("applies custom value color", () => {
    render(<MetricCard label="Overdue" value="7" valueColor="text-red-400" />);
    const valueEl = screen.getByText("7");
    expect(valueEl.className).toContain("text-red-400");
  });
});

describe("SummaryCard", () => {
  it("renders label and value", () => {
    render(<SummaryCard label="Avg Days" value="45" />);
    expect(screen.getByText("Avg Days")).toBeTruthy();
    expect(screen.getByText("45")).toBeTruthy();
  });
});
