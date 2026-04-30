import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

export default async function IntelligenceSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/intelligence");
  if (!user.roles.includes("ADMIN")) redirect("/");

  redirect("/suites/testing");
}
