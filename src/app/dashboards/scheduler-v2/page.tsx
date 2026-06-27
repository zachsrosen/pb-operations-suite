import { notFound } from "next/navigation";
import SchedulerV2Shell from "@/components/scheduler-v2/SchedulerV2Shell";
import { isSchedulerV2Enabled } from "@/lib/scheduler-v2/flag";

// The gate is a runtime SystemConfig flag, so this page must NOT be statically
// prerendered (a build-time render would bake in the flag value as of build).
export const dynamic = "force-dynamic";

export default async function SchedulerV2Page() {
  if (!(await isSchedulerV2Enabled())) {
    notFound();
  }

  return <SchedulerV2Shell />;
}
