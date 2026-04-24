import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import AccountsReceivableClient from "./AccountsReceivableClient";

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/accounts-receivable");
  const allowed = ["ADMIN", "EXECUTIVE", "OWNER", "ACCOUNTING"];
  if (!user.roles.some((r) => allowed.includes(r))) redirect("/");
  return <AccountsReceivableClient />;
}
