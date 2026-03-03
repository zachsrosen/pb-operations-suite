/**
 * Portal layout — minimal, public, no auth.
 * PB branding + clean mobile-first wrapper.
 */

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-t-border bg-surface px-4 py-4">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500">
              <span className="text-sm font-bold text-white">PB</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">Photon Brothers</h1>
              <p className="text-xs text-muted">Solar Site Survey</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-lg px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-t-border px-4 py-6 text-center">
        <p className="text-xs text-muted">
          Questions? Call us at{" "}
          <a href="tel:+13034300096" className="text-orange-500 hover:underline">
            (303) 430-0096
          </a>
        </p>
      </footer>
    </div>
  );
}
