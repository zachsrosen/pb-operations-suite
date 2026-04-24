import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import PaymentDataMismatchClient from "./PaymentDataMismatchClient";

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/payment-data-mismatch");
  // Admin + executive only — diagnostic view, not accounting-facing.
  const allowed = ["ADMIN", "EXECUTIVE", "OWNER"];
  if (!user.roles.some((r) => allowed.includes(r))) redirect("/");
  return <PaymentDataMismatchClient />;
}
