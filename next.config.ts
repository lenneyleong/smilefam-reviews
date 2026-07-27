import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // One hostname, one URL shape. Decided before any link is built, because
  // changing it afterwards means 301-ing every inbound link we earn.
  trailingSlash: false,
  poweredByHeader: false,
  images: {
    // Review photos are pre-optimized to WebP masters by scripts/images.ts and
    // served from our own origin, so no remote patterns are needed.
    formats: ["image/avif", "image/webp"],
    // Review photos render at ≤176 CSS px; 640 covers 2–3× DPR with headroom.
    // The default 1024/1400 candidates were unreachable dead srcset entries.
    deviceSizes: [320, 640],
  },
};

export default nextConfig;
