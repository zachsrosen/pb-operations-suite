import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { resolveNativeMode } from "@/lib/solar/native-mode";
import SolarSurveyorShell from "@/components/solar/SolarSurveyorShell";

export default async function SolarSurveyorPage() {
  const session = await auth();
  if (!session?.user?.email)
    redirect("/login?callbackUrl=/dashboards/solar-surveyor");

  const user = await getUserByEmail(session.user.email);
  if (!user) redirect("/");

  const { mode, reason } = resolveNativeMode();

  // Read user preference from DB
  const userPrefs = user.preferences as {
    solarPreferredEntryMode?: string;
  } | null;
  const preference =
    (userPrefs?.solarPreferredEntryMode as
      | "wizard"
      | "classic"
      | "browser"
      | null) ?? null;

  return (
    <SolarSurveyorShell
      initialMode={mode}
      modeReason={reason}
      userPreference={preference}
    />
  );
}
