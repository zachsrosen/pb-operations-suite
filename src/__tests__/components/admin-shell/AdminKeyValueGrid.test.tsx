import { render, screen } from "@testing-library/react";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";

describe("AdminKeyValueGrid", () => {
  it("renders items as label/value pairs", () => {
    render(
      <AdminKeyValueGrid
        items={[
          { label: "Email", value: "a@b.com" },
          { label: "Roles", value: "ADMIN, SERVICE" },
        ]}
      />,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("ADMIN, SERVICE")).toBeInTheDocument();
  });

  it("renders mono value in a <code> element", () => {
    render(
      <AdminKeyValueGrid items={[{ label: "ID", value: "abc-123", mono: true }]} />,
    );
    const v = screen.getByText("abc-123");
    expect(v.tagName.toLowerCase()).toBe("code");
  });
});
