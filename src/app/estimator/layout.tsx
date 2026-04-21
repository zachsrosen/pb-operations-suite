import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Solar Estimator | Photon Brothers",
  description:
    "Get an instant solar estimate for your home — system size, production, price, and financing, tailored to your address and utility.",
};

export default function EstimatorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-t-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/estimator" className="flex items-center gap-2">
            <Image
              src="/branding/photon-brothers-logo-mixed-white.svg"
              alt="Photon Brothers"
              width={160}
              height={32}
              priority
              className="h-8 w-auto"
            />
          </Link>
          <a
            href="https://www.photonbrothers.com"
            className="text-sm text-muted hover:text-foreground"
          >
            Return to photonbrothers.com
          </a>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-t-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-muted sm:px-6">
          <p>
            Estimates are based on typical system performance and current incentives. Your final
            quote will be prepared after a consult.
          </p>
          <p>© {new Date().getFullYear()} Photon Brothers. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
