import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import RtbReviewClient from "./RtbReviewClient";

export const dynamic = "force-dynamic";

export default async function RtbReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/dashboards/rtb-review");

  const allowed = new Set(["ADMIN", "OWNER", "PROJECT_MANAGER", "OPERATIONS_MANAGER"]);
  if (!user.roles.some((r: string) => allowed.has(r))) redirect("/");

  return <RtbReviewClient />;
}
