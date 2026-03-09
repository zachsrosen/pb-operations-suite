/**
 * SOP Content Sanitizer
 *
 * Sanitizes HTML content for the SOP guide. Used on both save (API) and
 * render (defense-in-depth). Preserves SOP-specific CSS classes, data
 * attributes, table attrs, and safe inline styles while stripping scripts,
 * event handlers, and dangerous URIs.
 */

import sanitizeHtml from "sanitize-html";

// SOP-specific CSS classes that must be preserved
const SOP_ALLOWED_CLASSES = [
  // Layout & cards
  "card", "card-hd", "info-box", "summary",
  // Automation chains (ac + variant modifiers)
  "ac", "ac-trig", "ac-chk", "ac-zup", "ac-not", "ac-calc",
  // Status flows
  "sf", "sp", "sp-r", "sp-h",
  // Pipeline visuals
  "pv", "ps", "ps-s", "ps-p", "ps-d", "ps-v", "ps-r", "ps-g",
  // Legend grid
  "lg", "lc",
  // Flow arrows
  "fa", "pa",
  // Info/warning/tip boxes
  "info", "warn", "tip",
  // Actor markers
  "you", "sys", "review",
  // Tags
  "t", "t-auto", "t-man", "t-trig", "t-zup", "t-chk", "t-calc", "t-not",
  // PM guide
  "pm-steps", "pm-step", "pm-checklist", "pm-tbd", "pm-naming",
  // Dots
  "dot", "dot-blue", "dot-green", "dot-amber", "dot-red", "dot-purple",
  "dot-pink", "dot-teal", "dot-indigo",
  // Pipeline stage blocks (ops guide)
  "pipeline-stage",
  // Stagger grid
  "stagger-grid",
  // Subtitle
  "subtitle",
  // App links
  "app-link",
  // Role badges
  "role-badge", "role-admin", "role-user",
  // Region markers (PM guide)
  "region-bar", "region-cosp", "market",
  // TBD placeholders
  "tbd-placeholder",
];

// Safe inline style properties (used for info boxes, colored borders, diagrams, etc.)
// Uses prefix matching for shorthand + longhand variants (e.g. margin matches margin-top)
const SAFE_STYLE_RE =
  /^(border(-left|-right|-top|-bottom|-radius)?|background(-color)?|padding(-top|-right|-bottom|-left)?|margin(-top|-right|-bottom|-left)?|color|font-(weight|style|size|family)|text-(align|transform|decoration)|letter-spacing|line-height|white-space|vertical-align|display|flex(-direction|-wrap|-shrink)?|align-items|justify-content|gap|grid-template-columns|max-width|width|min-width|height|min-height|overflow(-x|-y)?|opacity|position|top|right|bottom|left)\s*:/i;

// Dangerous CSS value patterns — deny even if property name is safe
// Covers exfiltration (url), XSS (expression, javascript:), and IE-specific vectors
const DANGEROUS_VALUE_RE =
  /url\s*\(|expression\s*\(|@import|javascript\s*:|-moz-binding|behavior\s*:/i;

/**
 * Filter inline style to only allow safe properties with safe values.
 * Each declaration must pass the property allowlist AND not match the value denylist.
 */
function filterStyle(style: string): string {
  return style
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && SAFE_STYLE_RE.test(s) && !DANGEROUS_VALUE_RE.test(s))
    .join("; ");
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Block elements
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "div", "span", "section",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "hr", "br",
    // Tables
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    // Inline
    "a", "strong", "em", "b", "i", "u", "s", "mark", "small", "sub", "sup",
    // Media (images only, no iframes/scripts)
    "img",
  ],
  allowedAttributes: {
    "*": ["class", "id", "style", "data-sop-link"],
    a: ["href", "target", "rel", "data-sop-link"],
    img: ["src", "alt", "width", "height"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Centralized style + link transforms for all tags
  transformTags: {
    "*": (tagName, attribs) => {
      // Filter inline styles on any element through the safe-property + safe-value checks
      if (attribs.style) {
        attribs.style = filterStyle(attribs.style);
        if (!attribs.style) delete attribs.style;
      }
      return { tagName, attribs };
    },
    a: (tagName, attribs) => {
      // Filter styles (same as "*")
      if (attribs.style) {
        attribs.style = filterStyle(attribs.style);
        if (!attribs.style) delete attribs.style;
      }
      // Ensure external links open in new tab
      if (attribs.href && !attribs["data-sop-link"]) {
        attribs.target = "_blank";
        attribs.rel = "noopener noreferrer";
      }
      return { tagName, attribs };
    },
  },
  // Don't strip unrecognized classes — the allowedClasses below handles this
  allowedClasses: {
    "*": SOP_ALLOWED_CLASSES,
  },
};

/**
 * Sanitize SOP HTML content.
 * Safe for both server-side (Node.js) and build-time usage.
 */
export function sanitizeSopContent(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
