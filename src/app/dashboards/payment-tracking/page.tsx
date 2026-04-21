import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import PaymentTrackingClient from "./PaymentTrackingClient";

export default async function PaymentTrackingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/payment-tracking");
  const allowed = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");
  return <PaymentTrackingClient />;
}
