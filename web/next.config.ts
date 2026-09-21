import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Pin the workspace root to this directory. Without it Next walks up looking
   for a lockfile, finds one in the user's home directory, and infers the whole
   home folder as the project root. */
const here = path.dirname(fileURLToPath(import.meta.url));

/* GitHub Pages serves a project site from /<repo>, so the app needs a basePath
   there and none locally. Driven by an env var rather than hardcoded, so the
   same source builds for `next dev` (empty) and for Pages (the repo name). */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',          // fully static: no server, Web Serial is client-side
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,       // /path/ -> /path/index.html, which Pages serves directly
  images: { unoptimized: true },
  reactStrictMode: true,
  turbopack: { root: here },
};

export default nextConfig;
