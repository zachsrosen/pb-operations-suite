import { notFound } from "next/navigation";
import SchedulerV2Shell from "@/components/scheduler-v2/SchedulerV2Shell";

export default function SchedulerV2Page() {
  if (process.env.NEXT_PUBLIC_UI_SCHEDULER_V2_ENABLED !== "true") {
    notFound();
  }

  return <SchedulerV2Shell />;
}
