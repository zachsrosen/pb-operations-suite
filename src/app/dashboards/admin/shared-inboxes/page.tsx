import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";

interface InboxStatus {
  label: string;
  address: string;
  connected: boolean;
  connectedBy: string | null;
  connectedAt: Date | null;
  lastRefreshAt: Date | null;
  lastRefreshErr: string | null;
  expiresAt: Date | null;
}

function readInboxEnv(name: string, fallback: string): string {
  const v = (process.env[name] ?? "").trim();
  return v || fallback;
}

export default async function SharedInboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string }>;
}) {
  const session = await auth();
  const roles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
  if (!session?.user) redirect("/");
  if (!roles.includes("ADMIN")) redirect("/");

  const { status, message } = await searchParams;

  // Known inboxes from env (Permit Hub + IC Hub).
  const known: Array<{ label: string; address: string }> = [
    {
      label: "Permits — Colorado",
      address: readInboxEnv("PERMIT_INBOX_CO", "permitsdn@photonbrothers.com"),
    },
    {
      label: "Permits — California",
      address: readInboxEnv("PERMIT_INBOX_CA", "permitting@photonbrothers.com"),
    },
    {
      label: "Interconnections — Colorado",
      address: readInboxEnv("IC_INBOX_CO", "interconnections@photonbrothers.com"),
    },
    {
      label: "Interconnections — California",
      address: readInboxEnv("IC_INBOX_CA", "interconnectionsca@photonbrothers.com"),
    },
  ];

  const creds = await prisma.sharedInboxCredential.findMany();
  const credsByAddress = new Map(creds.map((c) => [c.inboxAddress.toLowerCase(), c]));

  const rows: InboxStatus[] = known.map((k) => {
    const c = credsByAddress.get(k.address.toLowerCase());
    return {
      label: k.label,
      address: k.address,
      connected: !!c,
      connectedBy: c?.connectedBy ?? null,
      connectedAt: c?.connectedAt ?? null,
      lastRefreshAt: c?.lastRefreshAt ?? null,
      lastRefreshErr: c?.lastRefreshErr ?? null,
      expiresAt: c ? new Date(Number(c.tokenExpiry)) : null,
    };
  });

  return (
    <DashboardShell
      title="Shared Inbox Connections"
      accentColor="purple"
      fullWidth={false}
    >
      <div className="space-y-4">
        {status === "ok" && (
          <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            ✓ {message ?? "Success"}
          </div>
        )}
        {status === "error" && (
          <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            ✗ {message ?? "Failed"}
          </div>
        )}

        <div className="rounded-md bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-semibold">How this works</p>
          <p className="mt-1">
            Workaround for blocked Workspace domain-wide-delegation. Each shared
            inbox needs a one-time OAuth consent grant. When you click{" "}
            <strong>Connect</strong>, Google will prompt you to sign in —{" "}
            <strong>sign in AS the shared inbox account</strong> (not as yourself).
            You&apos;ll need the mailbox password from whoever owns it. After
            consent, tokens refresh automatically; you only redo this if refresh
            fails (shown below).
          </p>
        </div>

        <table className="w-full border-separate border-spacing-y-2 text-sm">
          <thead className="text-muted text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2">Inbox</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last refresh</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.address} className="bg-surface rounded-md">
                <td className="rounded-l-md px-3 py-3 font-medium">{r.label}</td>
                <td className="text-muted px-3 py-3 font-mono text-xs">
                  {r.address}
                </td>
                <td className="px-3 py-3">
                  {r.connected ? (
                    r.lastRefreshErr ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                        Refresh failing
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        Connected
                      </span>
                    )
                  ) : (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
                      Not connected
                    </span>
                  )}
                  {r.connectedBy && (
                    <div className="text-muted mt-1 text-xs">
                      by {r.connectedBy}
                    </div>
                  )}
                </td>
                <td className="text-muted px-3 py-3 text-xs">
                  {r.lastRefreshAt
                    ? r.lastRefreshAt.toLocaleString()
                    : "—"}
                  {r.lastRefreshErr && (
                    <div className="mt-1 text-red-600 dark:text-red-400">
                      {r.lastRefreshErr}
                    </div>
                  )}
                </td>
                <td className="rounded-r-md px-3 py-3 text-right">
                  <a
                    href={`/api/admin/shared-inbox/connect?inbox=${encodeURIComponent(r.address)}`}
                    className="inline-flex items-center gap-1 rounded-md bg-purple-500 px-3 py-1 text-xs font-medium text-white hover:bg-purple-600"
                  >
                    {r.connected ? "Reconnect" : "Connect"} ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-muted space-y-1 text-xs">
          <p>
            <strong>Before first Connect click:</strong> add this to the Google
            Cloud OAuth client&apos;s Authorized redirect URIs (GCP Console →
            APIs &amp; Services → Credentials → pick the client for{" "}
            <code>COMMS_GOOGLE_CLIENT_ID</code>):
          </p>
          <p>
            <code className="bg-surface-2 rounded px-1.5 py-0.5">
              https://www.pbtechops.com/api/admin/shared-inbox/callback
            </code>
          </p>
          <p>
            <strong>Signing in as the shared inbox:</strong> when Google shows
            the consent screen, click <em>&quot;Use another account&quot;</em>{" "}
            and enter the inbox credentials. The callback verifies that the
            Google account you signed in as matches the target inbox and
            rejects mismatches.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
