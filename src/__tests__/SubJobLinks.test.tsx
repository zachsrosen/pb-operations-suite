import { render, screen } from "@testing-library/react";
import { SubJobLinks } from "@/components/scheduler/SubJobLinks";
import type { SubJobInfo } from "@/lib/scheduler-subjobs";

const BASE = "https://web.zuperpro.com";

const subJobs: SubJobInfo[] = [
  { systemType: "solar", jobUid: "pv-1", status: "Scheduled" },
  { systemType: "battery", jobUid: "ess-1", status: "Ready" },
];

describe("SubJobLinks", () => {
  it("renders one labeled link per sub-job with correct hrefs", () => {
    render(<SubJobLinks subJobs={subJobs} zuperWebBaseUrl={BASE} variant="button" />);
    const pv = screen.getByRole("link", { name: /PV/ });
    const ess = screen.getByRole("link", { name: /ESS/ });
    expect(pv).toHaveAttribute("href", `${BASE}/jobs/pv-1/details`);
    expect(ess).toHaveAttribute("href", `${BASE}/jobs/ess-1/details`);
  });

  it("falls back to a single Zuper link when only a legacy job exists", () => {
    render(
      <SubJobLinks subJobs={[]} zuperJobUid="legacy-9" zuperWebBaseUrl={BASE} variant="compact" />,
    );
    const link = screen.getByRole("link", { name: /Zuper/i });
    expect(link).toHaveAttribute("href", `${BASE}/jobs/legacy-9/details`);
  });

  it("renders nothing when there is no job at all", () => {
    const { container } = render(
      <SubJobLinks subJobs={[]} zuperWebBaseUrl={BASE} variant="button" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
