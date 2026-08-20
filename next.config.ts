import type { NextConfig } from 'next';

// Node 24 runs the same .ts sources under `node --test` as Next bundles, so
// relative imports carry explicit .ts extensions everywhere. Node's ESM resolver
// requires the full specifier; `allowImportingTsExtensions` is what makes tsc agree.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Grader talks to the Agent SDK, which spawns a subprocess and reads
  // ~/.claude at call time (ADR 0001). It must never be traced into a bundle.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', 'better-sqlite3'],
};

export default nextConfig;
