/**
 * Lightweight HTML sanitizer for HubSpot engagement bodies (notes, emails).
 *
 * Strips HubSpot's verbose inline styles and classes while preserving
 * meaningful structure (paragraphs, line breaks, bold, links, images).
 * Uses the same sanitize-html package as sop-sanitize.ts.
 */
import sanitizeHtml from "sanitize-html";

const ENGAGEMENT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "div", "span", "br", "hr",
    "strong", "b", "em", "i", "u", "s", "mark", "small",
    "ul", "ol", "li",
    "a", "img",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tr", "th", "td",
    "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Strip all inline styles and classes — let our CSS handle appearance
  allowedStyles: {},
  allowedClasses: {},
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        target: "_blank",
        rel: "noopener noreferrer",
      },
    }),
  },
};

/**
 * Sanitize HubSpot engagement HTML for safe rendering.
 * All output is run through sanitize-html which strips scripts, event
 * handlers, dangerous URIs, and inline styles before the HTML is rendered.
 * Returns empty string for null/undefined input.
 */
export function sanitizeEngagementHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, ENGAGEMENT_SANITIZE_OPTIONS);
}
