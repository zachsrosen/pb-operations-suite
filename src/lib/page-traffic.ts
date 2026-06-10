// Known dynamic-route patterns: prefix → param label. Order matters (longest prefix first).
const DYNAMIC_ROUTES: Array<{ prefix: string; param: string }> = [
  { prefix: "/dashboards/reviews", param: "[dealId]" },
  { prefix: "/dashboards/catalog/edit", param: "[id]" },
];

/** Strip query/hash, trailing slash, and collapse a trailing dynamic segment to its route pattern. */
export function normalizePath(raw: string): string {
  if (!raw) return raw;
  let path = raw.split("?")[0].split("#")[0];
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  for (const { prefix, param } of DYNAMIC_ROUTES) {
    if (path === prefix) return path;
    if (path.startsWith(`${prefix}/`)) {
      // collapse exactly one segment after the prefix
      const rest = path.slice(prefix.length + 1).split("/")[0];
      if (rest) return `${prefix}/${param}`;
    }
  }
  // Generic fallback: collapse a trailing all-numeric segment to [id]
  const segs = path.split("/");
  const last = segs[segs.length - 1];
  if (last && /^\d+$/.test(last) && segs.length > 2) {
    segs[segs.length - 1] = "[id]";
    return segs.join("/");
  }
  return path;
}
