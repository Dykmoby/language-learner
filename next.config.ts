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

  // Everything under public/ is served with `Cache-Control: public, max-age=0`,
  // which for the three preloaded woff2 files means a blocking revalidation
  // round trip each, on every navigation, over a home uplink — before any text
  // is painted. They also fed the fail2ban jail three 304s per page view; see
  // deploy/fail2ban/filter.d/caddy-language-learner.conf.
  //
  // The filenames are not content-hashed, so `immutable` is a promise this repo
  // has to keep by hand: changing a font file means renaming it, not overwriting
  // it. That is the trade — a font the two of them fetch once instead of thirty
  // times a session, against a rename on the day a font actually changes.
  async headers() {
    return [
      {
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
