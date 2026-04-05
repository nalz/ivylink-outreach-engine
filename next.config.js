/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  // Neon serverless requires this for edge compatibility
  experimental: {
    serverComponentsExternalPackages: ['pg'],
  },
};

module.exports = nextConfig;
