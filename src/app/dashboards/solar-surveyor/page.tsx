import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import SolarIframeBridge from "./SolarIframeBridge";

const SOLAR_IFRAME_SRC = process.env.SOLAR_IFRAME_SRC || "https://solarsurveyor.vercel.app";

export default async function SolarSurveyorPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/dashboards/solar-surveyor");

  const user = await getUserByEmail(session.user.email);
  if (!user) redirect("/");

  const bridgeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-t-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/suites/design-engineering" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; D&E Suite
          </Link>
          <span className="text-t-border">|</span>
          <h1 className="text-sm font-semibold text-foreground">Solar Surveyor</h1>
        </div>
        <a
          href={SOLAR_IFRAME_SRC}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-orange-400 transition-colors"
        >
          Open in new tab &rarr;
        </a>
      </header>
      <SolarIframeBridge iframeSrc={SOLAR_IFRAME_SRC} user={bridgeUser} />
    </div>
  );
}
