import { render, screen } from "@testing-library/react";
import { DetailPanel } from "@/app/dashboards/map/DetailPanel";
import type { JobMarker, CrewPin } from "@/lib/map-types";

const scheduledInstall: JobMarker = {
  id: "install:PROJ-8241",
  kind: "install",
  scheduled: true,
  lat: 40.01,
  lng: -105.25,
  address: { street: "4820 Gunbarrel Ave", city: "Boulder", state: "CO", zip: "80301" },
  title: "Jenkins Residence",
  subtitle: "9:00 AM · Alex P.",
  status: "On Site",
  scheduledAt: "2026-04-23T16:00:00Z",
  dealId: "PROJ-8241",
};

const unscheduledTicket: JobMarker = {
  id: "ticket:3114",
  kind: "service",
  scheduled: false,
  lat: 40.02,
  lng: -105.27,
  address: { street: "1127 Elder Pl", city: "Boulder", state: "CO", zip: "80304" },
  title: "Monitoring offline",
  status: "Needs Dispatch",
  priorityScore: 68,
  ticketId: "3114",
};

describe("DetailPanel", () => {
  it("renders scheduled install sections", () => {
    render(<DetailPanel marker={scheduledInstall} markers={[]} crews={[]} onClose={jest.fn()} />);
    expect(screen.getByText("Jenkins Residence")).toBeInTheDocument();
    expect(screen.getByText(/^Schedule$/i)).toBeInTheDocument();
    expect(screen.getByText(/4820 Gunbarrel Ave/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in hubspot/i })).toBeInTheDocument();
  });

  it("shows priority score for unscheduled ticket", () => {
    render(<DetailPanel marker={unscheduledTicket} markers={[]} crews={[]} onClose={jest.fn()} />);
    expect(screen.getByText(/68/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /schedule this/i })).toBeInTheDocument();
  });

  it("renders closest crew list when crews provided", () => {
    const crews: CrewPin[] = [
      {
        id: "crew-1", name: "Alex P.", shopId: "dtc",
        currentLat: 40.02, currentLng: -105.28,
        routeStops: [], working: true,
      },
    ];
    render(<DetailPanel marker={unscheduledTicket} markers={[]} crews={crews} onClose={jest.fn()} />);
    expect(screen.getByText(/Alex P\./)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(<DetailPanel marker={scheduledInstall} markers={[]} crews={[]} onClose={onClose} />);
    screen.getByRole("button", { name: /close/i }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
