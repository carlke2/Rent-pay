import { existsSync } from "node:fs";
import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

/** A basic policy that allows the app itself. Next.js needs inline scripts/styles; dev mode also needs eval. */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // https: lets the landlord view payment slips through signed storage URLs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDevelopment ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  // The Dockerfile sets BUILD_STANDALONE=1 for Cloud Run; Vercel and local builds don't need it.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  // Checked at build time: on serverless hosts public/ is not on the function's disk at runtime.
  env: { SIGN_IN_PHOTO_PRESENT: existsSync("public/sign-in.jpg") ? "true" : "false" },
  reactStrictMode: true,
  // next/image serves AVIF where supported, else WebP (the sign-in photo is a JPEG on disk).
  images: { formats: ["image/avif", "image/webp"], deviceSizes: [360, 390, 640, 768, 1024, 1280, 1440, 1920] },
  devIndicators: false,
  // Stops next dev from generating AGENTS.md; this repo keeps no agent rule files.
  agentRules: false,
  // Payment slip photos can be up to 5 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
