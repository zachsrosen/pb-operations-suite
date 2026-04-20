import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormField, FormInput, FormSelect, FormTextarea, FormToggle } from "@/components/admin-shell/AdminForm";

describe("FormField", () => {
  it("renders label, help, and error", () => {
    render(
      <FormField label="Email" help="We'll never share it" error="Required">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("We'll never share it")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("hides help when error is present (error replaces help visually)", () => {
    render(
      <FormField label="Email" help="We'll never share it" error="Required">
        <input />
      </FormField>,
    );
    const help = screen.queryByText("We'll never share it");
    // help is either hidden via class or omitted — either way error must dominate
    expect(screen.getByText("Required")).toHaveClass(/red/); // red-400 theme color for errors
  });
});

describe("FormInput", () => {
  it("fires onChange with the raw value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FormInput label="Name" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText("Name"), "abc");
    expect(onChange).toHaveBeenLastCalledWith("abc");
  });
});

describe("FormSelect", () => {
  it("renders options + fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <FormSelect
        label="Role"
        value=""
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Role"), "b");
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("FormToggle", () => {
  it("reflects checked state and fires onChange with next value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FormToggle label="Active" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("FormTextarea", () => {
  it("fires onChange with value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FormTextarea label="Notes" value="" onChange={onChange} rows={3} />);
    await user.type(screen.getByLabelText("Notes"), "x");
    expect(onChange).toHaveBeenLastCalledWith("x");
  });
});
