"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import PropertyHubHeader from "@/components/property/PropertyHubHeader";
import PropertyHubTabs from "@/components/property/PropertyHubTabs";
import PropertyActivityTab from "@/components/property/PropertyActivityTab";
import PropertyDealsTab from "@/components/property/PropertyDealsTab";
import PropertyTicketsTab from "@/components/property/PropertyTicketsTab";
import PropertyJobsTab from "@/components/property/PropertyJobsTab";
import PropertyScheduleTab from "@/components/property/PropertyScheduleTab";
import PropertyEquipmentTab from "@/components/property/PropertyEquipmentTab";
import type { PropertyDetail } from "@/lib/property-detail";
import type { HubTab } from "@/lib/property-hub";

const VALID_TABS: HubTab[] = [
  "activity",
  "deals",
  "tickets",
  "jobs",
  "schedule",
  "equipment",
];

function isValidTab(t: string | null): t is HubTab {
  return !!t && VALID_TABS.includes(t as HubTab);
}

export default function PropertyHubPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get("tab");
  const activeTab: HubTab = isValidTab(tabParam) ? tabParam : "activity";

  // Header data — reuses existing property detail endpoint
  const {
    data: property,
    isLoading: headerLoading,
    error: headerError,
  } = useQuery<PropertyDetail>({
    queryKey: ["propertyDetail", id],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${id}`);
      if (!res.ok) throw new Error("Failed to load property");
      return res.json();
    },
    staleTime: 60_000,
  });

  function setTab(tab: HubTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/properties/${id}?${params.toString()}`, { scroll: false });
  }

  const address = property?.fullAddress ?? "Loading...";

  return (
    <DashboardShell
      title={address}
      accentColor="blue"
      fullWidth
    >
      <div className="space-y-6">
        <PropertyHubHeader
          property={property ?? null}
          loading={headerLoading}
          error={headerError}
        />

        <PropertyHubTabs activeTab={activeTab} onTabChange={setTab} />

        <div className="min-h-[400px]">
          {activeTab === "activity" && (
            <PropertyActivityTab propertyId={id} />
          )}
          {activeTab === "deals" && (
            <PropertyDealsTab propertyId={id} />
          )}
          {activeTab === "tickets" && (
            <PropertyTicketsTab propertyId={id} />
          )}
          {activeTab === "jobs" && (
            <PropertyJobsTab propertyId={id} />
          )}
          {activeTab === "schedule" && (
            <PropertyScheduleTab propertyId={id} />
          )}
          {activeTab === "equipment" && (
            <PropertyEquipmentTab propertyId={id} />
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
