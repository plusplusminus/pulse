import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

if (process.env.NODE_ENV === "development") {
  import("@opennextjs/cloudflare").then(({ initOpenNextCloudflareForDev }) =>
    initOpenNextCloudflareForDev()
  );
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Linear CDN domains (images embedded in comments/descriptions)
      { protocol: "https", hostname: "uploads.linear.app" },
      { protocol: "https", hostname: "linear-uploads.s3.amazonaws.com" },
      { protocol: "https", hostname: "public-files.linear.app" },
      // Supabase Storage (hub comment attachments)
      { protocol: "https", hostname: "kzxhksvvyfpkicodyzdi.supabase.co" },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        url: false,
        punycode: false,
        zlib: false,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        os: false,
        path: false,
      };
    }
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source map upload auth token
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload wider set of client source files for better stack trace resolution
  widenClientFileUpload: true,

  // Proxy route to bypass ad-blockers
  tunnelRoute: "/monitoring",

  // Suppress non-CI output
  silent: !process.env.CI,
});
