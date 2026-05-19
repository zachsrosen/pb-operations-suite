export interface PowerhubLinkProps {
  url: string | null | undefined;
  siteName?: string | null;
  variant?: "button" | "inline" | "icon";
  className?: string;
}

/**
 * Inline external-link icon. Inlined to avoid adding a new icon dependency —
 * the codebase doesn't use lucide-react.
 */
function ExternalLinkIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

/**
 * Deep link to a Tesla PowerHub site.
 *
 * Returns null when url is falsy — never renders a broken link.
 *
 * Variants:
 *   - button: full-width, themed button. Use in headers/hero areas.
 *   - inline: text link with external-link icon. Use in detail rows.
 *   - icon: bare icon. Use in compact table cells.
 */
export function PowerhubLink({
  url,
  siteName,
  variant = "inline",
  className,
}: PowerhubLinkProps) {
  if (!url) return null;

  const label = siteName ? `Open ${siteName} in Tesla PowerHub` : "Open in Tesla PowerHub";
  const linkText = siteName ?? "Tesla PowerHub";

  if (variant === "icon") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        aria-label={label}
        className={`inline-flex items-center text-muted hover:text-foreground transition-colors${className ? ` ${className}` : ""}`}
      >
        <ExternalLinkIcon size={14} />
      </a>
    );
  }

  if (variant === "button") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors${className ? ` ${className}` : ""}`}
      >
        <span>Open in Tesla PowerHub</span>
        <ExternalLinkIcon size={14} />
      </a>
    );
  }

  // inline
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-sm text-foreground hover:underline${className ? ` ${className}` : ""}`}
    >
      <span>{linkText}</span>
      <ExternalLinkIcon size={12} className="text-muted" />
    </a>
  );
}
