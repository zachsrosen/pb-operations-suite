import { render, screen, fireEvent } from "@testing-library/react";
import { MorningBriefing } from "@/app/dashboards/map/MorningBriefing";
import type { JobMarker } from "@/lib/map-types";
import type { OfficeLocation } from "@/lib/map-offices";

const dtc: OfficeLocation = {
  id: "dtc",
  label: "DTC",
  pbLocation: "DTC",
  lat: 39.5965,
  lng: -104.8847,
  address: "DTC, CO",
};

function makeMarker(id: string, lat: number, lng: number, scheduled = false): JobMarker {
  return {
    id,
    kind: "install",
    scheduled,
    lat,
    lng,
    address: { street: "", city: "", state: "CO", zip: "" },
    title: id,
  };
}

describe("MorningBriefing", () => {
  it("counts ready-to-schedule markers within radius and lists closest first", () => {
    const markers = [
      makeMarker("near-1", 39.60, -104.88),
      makeMarker("near-2", 39.61, -104.87),
      makeMarker("far", 38.00, -103.00), // outside radius
      makeMarker("near-scheduled", 39.60, -104.89, true), // scheduled = excluded
    ];
    render(
      <MorningBriefing
        office={dtc}
        markers={markers}
        radiusMiles={10}
        onMarkerClick={jest.fn()}
        onChangeOffice={jest.fn()}
      />
    );
    // "2 ready-to-schedule jobs" — check the count span (exact text)
    expect(screen.getByText("2", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/ready-to-schedule job/i)).toBeInTheDocument();
    expect(screen.getByText("near-1")).toBeInTheDocument();
    expect(screen.getByText("near-2")).toBeInTheDocument();
    expect(screen.queryByText("far")).not.toBeInTheDocument();
    expect(screen.queryByText("near-scheduled")).not.toBeInTheDocument();
  });

  it("shows empty-state message when nothing is nearby", () => {
    render(
      <MorningBriefing
        office={dtc}
        markers={[makeMarker("far", 38.00, -103.00)]}
        radiusMiles={10}
        onMarkerClick={jest.fn()}
        onChangeOffice={jest.fn()}
      />
    );
    expect(screen.getByText(/no ready-to-schedule jobs/i)).toBeInTheDocument();
  });

  it("calls onMarkerClick when a ready item is clicked", () => {
    const onMarkerClick = jest.fn();
    const markers = [makeMarker("near-1", 39.60, -104.88)];
    render(
      <MorningBriefing
        office={dtc}
        markers={markers}
        radiusMiles={10}
        onMarkerClick={onMarkerClick}
        onChangeOffice={jest.fn()}
      />
    );
    fireEvent.click(screen.getByText("near-1"));
    expect(onMarkerClick).toHaveBeenCalledWith(expect.objectContaining({ id: "near-1" }));
  });
});
