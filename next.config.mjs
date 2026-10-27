/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: { '/': ['./.generated/web.html'] },
  async headers() {
    return [
      {
        source: '/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; script-src 'wasm-unsafe-eval'; connect-src 'none'",
          },
        ],
      },
    ];
  },
};
