import type { NextConfig } from 'next';

// Node 24 runs the same .ts sources under `node --test` as Next bundles, so
// relative imports carry explicit .ts extensions everywhere. Node's ESM resolver
// requires the full specifier; `allowImportingTsExtensions` is what makes tsc agree.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Grader talks to the Agent SDK, which spawns a subprocess and reads
  // ~/.claude at call time (ADR 0001). It must never be traced into a bundle.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', 'better-sqlite3'],
  experimental: {
    // Lets a page refuse with a real 403 through forbidden(). A locked Lesson
    // that answered 200 with an apology would be refused in wording only, and a
    // 404 would lie: the Student can see the Lesson listed in their Course.
    authInterrupts: true,
  },
};

export default nextConfig;
