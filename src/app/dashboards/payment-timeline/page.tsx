import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import PaymentTimelineClient from "./PaymentTimelineClient";

export default async function PaymentTimelinePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/payment-timeline");
  const allowed = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");
  return <PaymentTimelineClient />;
}
