import type { NextConfig } from "next";

// STATIC_EXPORT builds a fully static site for hosts with no image optimizer
// (GitHub Pages preview). Production on Vercel/CF stays on the default path.
const staticExport = !!process.env.STATIC_EXPORT;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // One hostname, one URL shape. Decided before any link is built, because
  // changing it afterwards means 301-ing every inbound link we earn.
  trailingSlash: false,
  poweredByHeader: false,
  ...(staticExport && {
    output: "export" as const,
    basePath: process.env.BASE_PATH ?? "",
  }),
  images: {
    // Review photos are pre-optimized to WebP masters by scripts/images.ts and
    // served from our own origin, so no remote patterns are needed.
    formats: ["image/avif", "image/webp"],
    // Review photos render at ≤176 CSS px; 640 covers 2–3× DPR with headroom.
    // The default 1024/1400 candidates were unreachable dead srcset entries.
    deviceSizes: [320, 640],
    // The committed WebP masters are already sized for display; without the
    // optimizer the srcset is lost, so masters are served as-is.
    unoptimized: staticExport,
  },
};

export default nextConfig;
