/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // docker runtime image ships only .next/standalone
  // ponytail: no next/image, so drop sharp's per-CPU binary and keep the image arch-neutral
  images: { unoptimized: true },
  outputFileTracingExcludes: { '*': ['node_modules/@img/**', 'node_modules/sharp/**'] },
  devIndicators: false,
  // Next 16 blocks dev-server HMR/resources from any host but localhost; list LAN hosts via NEXT_DEV_ORIGINS (comma separated)
  allowedDevOrigins: (process.env.NEXT_DEV_ORIGINS || '').split(',').filter(Boolean),

  // Suppress HMR warnings in development
  onDemandEntries: {
    // period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: 25 * 1000,
    // number of pages that should be kept simultaneously without being disposed
    pagesBufferLength: 2,
  },
  
  // Skip trailing slash redirect to avoid routing issues
  skipTrailingSlashRedirect: true,
  
  
  // Environment variables
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 't@sk4ce',
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api/proxy',
  },
  
  // WebSocket Proxy (API proxy handled by pages/api/proxy/[...path].ts)
  async rewrites() {
    return [
      {
        source: '/ws/:path*',
        destination: `${process.env.BACKEND_INTERNAL_URL || 'http://backend:8000'}/ws/:path*`,
      },
    ]
  },
  
  // Security headers
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
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ]
  },
  
}

module.exports = nextConfig
