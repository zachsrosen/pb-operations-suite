import Link from "next/link";
import Image from "next/image";

interface PhotonBrothersBadgeProps {
  href?: string;
  compact?: boolean;
  className?: string;
  /** Override the default title/aria-label (e.g. "Back to Dashboard") */
  label?: string;
}

export default function PhotonBrothersBadge({
  href = "/",
  compact = false,
  className = "",
  label,
}: PhotonBrothersBadgeProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-lg border border-[#748aa5]/35 bg-gradient-to-r from-[#27384b] to-[#1a2636] px-2 py-1 shadow-sm ${className}`}
      title={label || "Photon Brothers"}
      aria-label={label || "Photon Brothers"}
    >
      <Image
        src="/branding/photon-brothers-logo-mixed-white.svg"
        alt="Photon Brothers"
        width={699}
        height={216}
        className={compact ? "h-4 w-auto" : "h-5 w-auto"}
      />
    </Link>
  );
}
