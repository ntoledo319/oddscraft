import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true, // Panta API paths require trailing slashes
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Wallet-adapter pulls Ledger packages whose lib-es ESM breaks Node resolution
  // during SSR page-data collection; keep them out of the server bundle.
  serverExternalPackages: [
    '@ledgerhq/hw-transport',
    '@ledgerhq/hw-transport-webhid',
    '@ledgerhq/hw-transport-webusb',
    '@ledgerhq/devices',
    '@solana/wallet-adapter-wallets',
    '@jup-ag/wallet-adapter',
  ],
};

export default nextConfig;
