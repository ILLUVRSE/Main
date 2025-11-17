/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Enable the App Router (Next 13+)
  experimental: {
    appDir: true
  },
  // Configure allowed remote image hosts for <Image /> and prefetching
  images: {
    remotePatterns: [
      // Local dev server
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '3000',
        pathname: '/**'
      },
      // Common S3 pattern (audit/artifacts)
      {
        protocol: 'https',
        hostname: '**.s3.amazonaws.com',
        pathname: '/**'
      },
      // Optional CDN host (replace with your real CDN host)
      {
        protocol: 'https',
        hostname: 'cdn.illuvrse.com',
        pathname: '/**'
      }
    ]
  },
  // Expose minimal runtime env defaults for client
  env: {
    NEXT_PUBLIC_MARKETPLACE_BASE_URL:
      process.env.NEXT_PUBLIC_MARKETPLACE_BASE_URL || 'http://127.0.0.1:3000',
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV || 'dev'
  },
  typescript: {
    // Fail builds on type errors in CI; during dev you can set this to false if needed
    ignoreBuildErrors: false
  }
};

module.exports = nextConfig;

