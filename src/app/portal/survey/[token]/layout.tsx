/**
 * Portal layout — minimal, public, no auth.
 * Premium Photon Brothers branded customer portal.
 */

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Header */}
      <header className="relative bg-gradient-to-r from-[#0f1b3d] to-[#1a2d5e]">
        <div className="mx-auto max-w-lg px-5 py-5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm ring-1 ring-white/20">
              <span className="text-sm font-bold text-white">PB</span>
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight text-white">
                Photon Brothers
              </h1>
              <p className="text-[11px] font-medium tracking-wide text-white/60">
                SOLAR SITE SURVEY
              </p>
            </div>
          </div>
        </div>
        {/* Orange accent divider */}
        <div className="h-[3px] bg-gradient-to-r from-[#f97316] via-[#fb923c] to-[#f97316]" />
      </header>

      {/* Content */}
      <main className="mx-auto max-w-lg px-5 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white px-5 py-8 text-center">
        <p className="text-[13px] text-gray-500">
          Questions? Call us at{" "}
          <a
            href="tel:+13034300096"
            className="font-semibold text-[#f97316] hover:text-[#ea580c] transition-colors"
          >
            (303) 430-0096
          </a>
        </p>
        <p className="mt-2 text-[11px] text-gray-400">
          &copy; {new Date().getFullYear()} Photon Brothers Solar
        </p>
      </footer>
    </div>
  );
}
