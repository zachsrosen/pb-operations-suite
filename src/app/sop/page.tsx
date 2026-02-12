import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

export default async function SOPPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/sop");

  const user = await getUserByEmail(session.user.email);
  if (!user || user.role !== "ADMIN") redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-t-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/suites/admin" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; Admin Suite
          </Link>
          <span className="text-t-border">|</span>
          <h1 className="text-sm font-semibold text-foreground">Standard Operating Procedures</h1>
          <span className="text-xs font-medium px-2 py-0.5 rounded border bg-teal-500/20 text-teal-400 border-teal-500/30">
            SOP
          </span>
        </div>
        <a
          href="/prototypes/sop-operations-guide.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-orange-400 transition-colors"
        >
          Open in new tab &rarr;
        </a>
      </header>
      <iframe
        src="/prototypes/sop-operations-guide.html"
        className="flex-1 w-full border-none"
        title="Standard Operating Procedures - Solar Operations Guide"
      />
    </div>
  );
}
