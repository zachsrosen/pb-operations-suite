/**
 * Regression guard: ProjectDetail must mount EscalationPhotoGallery for
 * ESCALATION items (and only those). PR #1356 branched off stale main and its
 * merge silently removed this mount, so uploaded escalation photos stopped
 * appearing in the detail panel. This test fails if the mount is dropped again.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/contexts/ToastContext";
import { ProjectDetail } from "@/app/dashboards/idr-meeting/ProjectDetail";
import type { IdrItem } from "@/app/dashboards/idr-meeting/IdrMeetingClient";

// Mock the heavy child sections so the tree renders without their queries.
jest.mock("@/app/dashboards/idr-meeting/InstallPlanningForm", () => ({ InstallPlanningForm: () => null }));
jest.mock("@/app/dashboards/idr-meeting/StatusActionsForm", () => ({ StatusActionsForm: () => null }));
jest.mock("@/app/dashboards/idr-meeting/MeetingNotesForm", () => ({ MeetingNotesForm: () => null }));
jest.mock("@/app/dashboards/idr-meeting/AhjUtilityInfo", () => ({ AhjUtilityInfo: () => null }));
jest.mock("@/app/dashboards/idr-meeting/AddersChecklist", () => ({ AddersChecklist: () => null }));
jest.mock("@/app/dashboards/idr-meeting/BomReviewSection", () => ({ BomReviewSection: () => null }));
jest.mock("@/components/deal-detail/PhotoGalleryCard", () => ({ __esModule: true, default: () => null }));
// The component under interest — render a marker so we assert on the mount, not its internals.
jest.mock("@/app/dashboards/idr-meeting/EscalationPhotoGallery", () => ({
  EscalationPhotoGallery: ({ dealId }: { dealId: string }) => (
    <div data-testid="escalation-gallery">gallery:{dealId}</div>
  ),
}));

beforeAll(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({}),
  })) as unknown as typeof fetch;
});

function makeItem(overrides: Partial<IdrItem>): IdrItem {
  const base = {
    id: "item-1", sessionId: "sess-1", dealId: "deal-123", type: "IDR",
    region: "Centennial", pipeline: null, sortOrder: 0,
    dealName: "PROJ-1000 | Tester, Sam", address: null, projectType: null,
    equipmentSummary: null, systemSizeKw: null, dealAmount: null, dealOwner: null,
    siteSurveyor: null, projectManager: null, operationsManager: null, designLead: null,
    permitLead: null, surveyStatus: null, surveyDate: null, designStatus: null,
    designApprovalStatus: null, plansetDate: null, driveFolderUrl: null, surveyFolderUrl: null,
    designFolderUrl: null, salesFolderUrl: null, ahj: null, utilityCompany: null,
    openSolarUrl: null, surveyCompleted: false, tags: [], salesNotes: null,
    salesChangeOrderNotes: null, salesChangeOrderNeeded: false, notesForDesign: null,
    specificNotesForDesign: null, snapshotUpdatedAt: "2026-07-10T00:00:00Z",
    difficulty: null, installerCount: null, installerDays: null, electricianCount: null,
    electricianDays: null, discoReco: null, interiorAccess: null, needsSurveyInfo: null,
    needsResurvey: null, salesChangeRequested: null, salesChangeNotes: null,
    salesChangeAmount: null, opsChangeNotes: null, customerNotes: null,
    customerNotesCreateTask: false, operationsNotes: null, opsRevisionNotes: null,
    designNotes: null, conclusion: null, escalationReason: null, reviewed: false,
    shitShowFlagged: false, shitShowReason: null, designRevisionNeeded: false,
    designRevisionReason: null, needsReReview: false,
    adderTileRoof: false, adderMetalRoof: false, adderFlatFoamRoof: false,
    adderShakeRoof: false, adderSteepPitch: false, adderTwoStorey: false,
    adderTrenching: false, adderGroundMount: false, adderMpuUpgrade: false,
    adderEvCharger: false, adderTier1: false, adderTier2: false, customAdders: [],
  } as unknown as IdrItem;
  return { ...base, ...overrides };
}

function renderDetail(item: IdrItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ProjectDetail
          item={item}
          onChange={jest.fn(async () => {})}
          readOnly={false}
          isPreview={false}
          sessionId="sess-1"
          userEmail="tester@photonbrothers.com"
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectDetail escalation gallery mount", () => {
  it("mounts the gallery for ESCALATION items", () => {
    renderDetail(makeItem({ type: "ESCALATION", dealId: "deal-esc", escalationReason: "roof concern" }));
    expect(screen.getByTestId("escalation-gallery")).toHaveTextContent("gallery:deal-esc");
  });

  it("does not mount the gallery for non-escalation items", () => {
    renderDetail(makeItem({ type: "IDR", dealId: "deal-idr" }));
    expect(screen.queryByTestId("escalation-gallery")).toBeNull();
  });
});
