import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next generates its own agent instruction files on build; this project does
  // not use them and they only add noise to the repository.
  agentRules: false,
}

export default nextConfig
