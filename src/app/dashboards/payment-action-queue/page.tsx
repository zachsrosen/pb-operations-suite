import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import PaymentActionQueueClient from "./PaymentActionQueueClient";

export default async function PaymentActionQueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/payment-action-queue");
  const allowed = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");
  return <PaymentActionQueueClient />;
}
