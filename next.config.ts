import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Compress responses for faster transfers
  compress: true,

  // Optimize powered-by header removal
  poweredByHeader: false,

  // Restrict remote image sources to known domains
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.hubspot.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },

  // Cache static assets aggressively
  headers: async () => [
    {
      source: "/dashboards/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
      ],
    },
    {
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-cache, no-store, must-revalidate" },
      ],
    },
    {
      source: "/api/stream",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-transform" },
        { key: "Connection", value: "keep-alive" },
        { key: "X-Accel-Buffering", value: "no" },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  // Suppress source map upload logs during build
  silent: true,

  // Hide source maps from clients
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  // Route client reports through /monitoring to bypass ad blockers
  tunnelRoute: "/monitoring",

  // Upload larger set of source maps for better stack traces
  widenClientFileUpload: true,
});
