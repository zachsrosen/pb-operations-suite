import { notFound } from "next/navigation";
import SchedulerV2Shell from "@/components/scheduler-v2/SchedulerV2Shell";
import { isSchedulerV2Enabled } from "@/lib/scheduler-v2/flag";

export default async function SchedulerV2Page() {
  if (!(await isSchedulerV2Enabled())) {
    notFound();
  }

  return <SchedulerV2Shell />;
}
