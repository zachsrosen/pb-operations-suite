/**
 * Portal layout — minimal, public, no auth.
 * Photon Brothers brand: white page body with a dark navy header strip +
 * orange logo badge and CTAs. Mirrors photonbrothers.com's top-bar treatment.
 */

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      {/* Header — dark navy strip with orange PB badge */}
      <header className="bg-[#3F4F62] px-4 py-4">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FF9E1B]">
              <span className="text-sm font-bold text-white">PB</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-white">Photon Brothers</h1>
              <p className="text-xs text-white/70">Solar Site Survey</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-lg px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5E7EB] px-4 py-6 text-center">
        <p className="text-xs text-[#6B7280]">
          Questions? Call us at{" "}
          <a href="tel:+13034300096" className="text-[#FF9E1B] hover:text-[#DF8407] hover:underline">
            (303) 430-0096
          </a>
        </p>
      </footer>
    </div>
  );
}
