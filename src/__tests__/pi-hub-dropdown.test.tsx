import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/contexts/ToastContext";
import { StatusDropdown } from "@/app/dashboards/pi-hub/StatusDropdown";

// "Pending SolarApp" and "Complete" have a label distinct from the value, so
// tests can prove the VALUE (not the label) is what gets POSTed.
const OPTIONS = [
  { value: "Ready For Permitting", label: "Ready For Permitting" },
  { value: "Pending SolarApp", label: "Ready to Submit for SolarApp" },
  { value: "Submitted to AHJ", label: "Submitted to AHJ" },
  { value: "Complete", label: "Permit Issued" },
];
const TERMINAL = ["Complete", "Not Needed"];

interface SetupOpts {
  statusJson?: unknown;
  onStatusBody?: (body: Record<string, unknown>) => void;
}

function setupFetch(opts: SetupOpts = {}) {
  const fn = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/pi-hub/options")) {
      return {
        ok: true,
        json: async () => ({ options: OPTIONS, terminalStatuses: TERMINAL }),
      } as unknown as Response;
    }
    if (url.includes("/api/pi-hub/status")) {
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : {};
      opts.onStatusBody?.(body);
      return {
        ok: true,
        json: async () => opts.statusJson ?? { ok: true, warnings: [] },
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  (global as { fetch: unknown }).fetch = fn;
  return fn;
}

function renderDropdown(props?: { compact?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <StatusDropdown
          team="permit"
          dealId="123"
          currentStatus="Ready For Permitting"
          currentStatusLabel="Ready For Permitting"
          compact={props?.compact}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("StatusDropdown", () => {
  afterEach(() => jest.restoreAllMocks());

  it("renders the current status label", () => {
    setupFetch();
    renderDropdown();
    expect(screen.getByText("Ready For Permitting")).toBeInTheDocument();
  });

  it("loads options from /api/pi-hub/options and renders their labels", async () => {
    const user = userEvent.setup();
    const fetchFn = setupFetch();
    renderDropdown();

    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));

    expect(await screen.findByText("Permit Issued")).toBeInTheDocument();
    expect(screen.getByText("Ready to Submit for SolarApp")).toBeInTheDocument();
    expect(screen.getByText("Submitted to AHJ")).toBeInTheDocument();
    // Fetched with the team query param.
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/api/pi-hub/options?team=permit"),
      expect.anything(),
    );
  });

  it("POSTs the option VALUE (not the label) for a non-terminal option", async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | null = null;
    setupFetch({ onStatusBody: (b) => (body = b) });
    renderDropdown();

    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Ready to Submit for SolarApp" }),
    );

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.status).toBe("Pending SolarApp");
    expect(body!.status).not.toBe("Ready to Submit for SolarApp");
    expect(body!.team).toBe("permit");
    expect(body!.dealId).toBe("123");
  });

  it("confirms before a terminal write; cancel does not POST, confirm does", async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | null = null;
    setupFetch({ onStatusBody: (b) => (body = b) });
    renderDropdown();

    // Select the terminal option -> confirm dialog, no POST yet. Queried by
    // role: the backdrop no longer carries aria-hidden, so the dialog is
    // reachable in the accessibility tree.
    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Permit Issued" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Set terminal status?");
    expect(body).toBeNull();

    // Cancel -> still no POST.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(body).toBeNull();

    // Reopen, select terminal again, confirm -> POST with the VALUE.
    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Permit Issued" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set status" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.status).toBe("Complete");
  });

  it("surfaces warnings as a non-error inline notice (detail header)", async () => {
    const user = userEvent.setup();
    setupFetch({ statusJson: { ok: true, warnings: ["note failed: boom"] } });
    renderDropdown();

    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Submitted to AHJ" }));

    expect(await screen.findByText(/note failed: boom/)).toBeInTheDocument();
    // The stable detail header reports inline; it must not also toast.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("compact mode routes warnings to a toast, not an inline notice", async () => {
    const user = userEvent.setup();
    setupFetch({ statusJson: { ok: true, warnings: ["note failed: boom"] } });
    renderDropdown({ compact: true });

    await user.click(screen.getByRole("button", { name: /Set status/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Submitted to AHJ" }));

    // A compact row usually re-groups and unmounts after the write, so the
    // warning has to live outside this component.
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Status saved, with warnings");
    expect(toast).toHaveTextContent("note failed: boom");
  });

  it("compact mode renders a small 'Set status' trigger", () => {
    setupFetch();
    renderDropdown({ compact: true });
    expect(
      screen.getByRole("button", { name: /Set status/i }),
    ).toBeInTheDocument();
  });

  it("exposes options as menuitems inside the menu", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderDropdown();

    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));

    // role="menu" containing a bare <ul> announces as an empty menu; the list
    // roles are stripped so the options are the menu's direct items.
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(OPTIONS.length);
    // Accessible name, not textContent: terminal rows append a "Terminal" badge.
    expect(
      screen.getByRole("menuitem", { name: "Submitted to AHJ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Permit Issued/ }),
    ).toBeInTheDocument();
  });

  it("closes on Escape without writing", async () => {
    const user = userEvent.setup();
    let body: Record<string, unknown> | null = null;
    setupFetch({ onStatusBody: (b) => (body = b) });
    renderDropdown();

    await user.click(screen.getByRole("button", { name: /Ready For Permitting/ }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(body).toBeNull();
  });
});
