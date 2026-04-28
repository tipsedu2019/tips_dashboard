import type { NextConfig } from "next";
import { realpathSync } from "node:fs";

import { resolveTipsPublicEnv } from "./public-env";

const appDir = process.cwd();
const turbopackRoot = realpathSync.native(appDir);
const publicEnv = resolveTipsPublicEnv(process.env, { appDir });

const nextConfig: NextConfig = {
  env: publicEnv,
  experimental: {
    externalDir: true,
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
  turbopack: {
    root: turbopackRoot,
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ui.shadcn.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
    formats: ['image/webp', 'image/avif'],
  },

  // Headers for better security and performance
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
    ];
  },

  // Redirects for better SEO
  async redirects() {
    return [
      {
        source: '/home',
        destination: '/admin/dashboard',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
