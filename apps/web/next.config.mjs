import withBundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env['NODE_ENV'] === 'development';
// Opt-in standalone output, set only by the Docker production build
// (Dockerfile). Every other path keeps the default server output.
const standaloneOutput = process.env['BUILD_STANDALONE'] === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Do not let `next dev` write AGENTS.md / CLAUDE.md into the repo.
  agentRules: false,
  // `next build` type-checks after compiling, which needs gigabytes on top of
  // the compile step. `pnpm lint` (tsc) already runs before every push, so a
  // small server can skip the second pass with SKIP_TYPECHECK=true.
  typescript: { ignoreBuildErrors: process.env['SKIP_TYPECHECK'] === 'true' },
  // Lets a test build run beside a live `next dev`, which owns `.next`.
  distDir: process.env['NEXT_DIST_DIR'] || '.next',
  // The Docker production image opts into a self-contained `.next/standalone`
  // tree (see Dockerfile) so it can ship only the traced runtime; all other
  // builds fall back to the default server output.
  output: standaloneOutput ? 'standalone' : undefined,
  // Monorepo: trace from the repo root so workspace packages land in the
  // standalone tree. Only relevant to — and only set for — the Docker build.
  outputFileTracingRoot: standaloneOutput ? path.join(__dirname, '../../') : undefined,
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  experimental: {
    // Dev caching is on by default since Next 16.1. We deliberately do NOT
    // enable Turbopack's build cache (turbopackFileSystemCacheForBuild, beta):
    // a build interrupted mid-compile leaves a partial cache that the next
    // build mishandles, fanning out workers until it exhausts RAM.
    turbopackFileSystemCacheForDev: true,
    // `middleware.ts` matches /api/*, so Next buffers a clone of every request
    // body to let both the middleware and the route handler read it. Past this
    // limit the clone is truncated and the handler sees a short body ending
    // cleanly — an upload that "succeeds" while storing a corrupt file, with no
    // error to the client (#6091).
    //
    // The clone is buffered in memory before any handler can reject it, which
    // makes this ceiling an unauthenticated memory budget on every /api/* route
    // — so only the self-hosted image, which may proxy whole book files through
    // the Node server, gets real headroom. `standaloneOutput` is the right gate
    // because BUILD_STANDALONE is set by the Dockerfile alone: cognoscimus.sixt.services
    // runs on Cloudflare/Vercel, never on that image. (This value is baked into
    // required-server-files.json at build time, so a runtime env var could not
    // do the same job.)
    //
    // 32MB is deliberately under SEND_INBOX_FILE_MAX_BYTES (40MB): the only
    // build that both runs the Node server and takes that route is a plain
    // `next start`, since Cloudflare and Vercel never reach this code path, so
    // the tighter budget is worth more there than the last 8MB of an upload.
    proxyClientMaxBodySize: standaloneOutput ? 1024 * 1024 * 1024 : 32 * 1024 * 1024,
  },
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
  serverExternalPackages: ['isows'],
  allowedDevOrigins: ['192.168.2.120'],
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      nunjucks: 'nunjucks/browser/nunjucks.js',
      // `js-mdict` is consumed as TS source via tsconfig paths from
      // `packages/js-mdict/src/`; its sources `import 'fflate'` directly.
      // Without an alias, webpack walks up from that source location and
      // can't find fflate (only installed in this app's node_modules).
      fflate: path.resolve(__dirname, 'node_modules/fflate'),
      // music-metadata only parses user-picked files in the browser; its
      // file-type dependency leaves a webpackIgnore'd `import('strtok3')` in
      // the server bundle that the OpenNext esbuild pass cannot resolve.
      ...(isServer
        ? {
            '@readest/turso-database-wasm/webpack': false,
            'jieba-wasm': false,
            'music-metadata': false,
          }
        : {}),
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      nunjucks: 'nunjucks/browser/nunjucks.js',
      // Turbopack rejects absolute paths in resolveAlias ("server relative
      // imports not implemented") — use a project-relative path.
      fflate: './node_modules/fflate',
    },
  },
  transpilePackages: [
    'ai',
    ...(isDev
      ? []
      : [
          'i18next-browser-languagedetector',
          'react-i18next',
          'i18next',
          'highlight.js',
          'foliate-js',
          'marked',
        ]),
  ],
  async rewrites() {
    return [
      {
        source: '/reader/:ids',
        destination: '/reader?ids=:ids',
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          // Next warns about (and can break dev with) a custom Cache-Control
          // in development, so it is only set for production builds.
          ...(isDev
            ? []
            : [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]),
        ],
      },
    ];
  },
};

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withAnalyzer(nextConfig);
