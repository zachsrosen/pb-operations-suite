export const ESCALATION_PHOTO_PREFIX = "escalation-photos/";
export const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
]);
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/** Returns an error string if invalid, else null. */
export function validatePhotoUpload(type: string, size: number): string | null {
  if (!ALLOWED_PHOTO_TYPES.has(type)) {
    return "Only JPEG, PNG, WebP, and GIF images are allowed";
  }
  if (size > MAX_PHOTO_BYTES) return "Image must be under 5 MB";
  return null;
}

/** Guard for the streaming proxy: only our prefix, no traversal. */
export function isAllowedPhotoPath(path: string): boolean {
  return path.startsWith(ESCALATION_PHOTO_PREFIX) && !path.includes("..");
}

/** Same-origin proxy URL for a private blob pathname. */
export function photoViewerUrl(blobPath: string): string {
  return `/api/idr-meeting/escalation-photos/view?path=${encodeURIComponent(blobPath)}`;
}
