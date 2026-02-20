import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

export default async function SolarSurveyorPrototypePage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/prototypes/solar-surveyor");

  const user = await getUserByEmail(session.user.email);
  if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-t-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/suites/testing" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Testing Suite
          </Link>
          <span className="text-t-border">|</span>
          <h1 className="text-sm font-semibold text-foreground">Solar Surveyor v11</h1>
          <span className="text-xs font-medium px-2 py-0.5 rounded border bg-pink-500/20 text-pink-400 border-pink-500/30">
            PROTOTYPE
          </span>
        </div>
        <a
          href="/prototypes/solar-surveyor-v11.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-orange-400 transition-colors"
        >
          Open in new tab &rarr;
        </a>
      </header>
      <iframe
        src="/prototypes/solar-surveyor-v11.html"
        className="flex-1 w-full border-none"
        title="Solar Surveyor v11 Prototype"
      />
    </div>
  );
}
