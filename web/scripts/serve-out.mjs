#!/usr/bin/env node
/**
 * `npm run serve:out`: serve the static export in out/ on localhost, to look at a build the way
 * `next dev` cannot show it - above all a PREVIEW build (`npm run build:preview`), the only one
 * that draws the experimental tabs (CODING, TEST).
 *
 * On PORT when something assigns one (the desktop app's preview pane does), else 5050 - the port
 * after this app's dev port. localhost is a secure context, so Web Serial works here in desktop
 * Chrome or Edge: the UNO and the K+DCAN cable can be used against this server as against the
 * deployed preview.
 *
 * What it is not: the preview. There are no functions here - no owner gate, no SYNC, no
 * /api/ref (every /api/ path is 404, which the app reads as "not uploaded yet"), so CODING's
 * definitions and TEST's names are opened as files. Nothing is cached (`no-store`), so a rebuild
 * is what the next reload shows.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'out');
const port = Number(process.env.PORT?.trim() || 5050);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

if (!existsSync(join(OUT, 'index.html'))) {
  console.error(`serve-out: no build in ${OUT}. Run \`npm run build:preview\` (or \`npm run build\`) first.`);
  process.exit(1);
}

/** The file a path names inside out/, or null - never anything outside it. */
function fileFor(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const base = normalize(join(OUT, rel));
  if (base !== OUT && !base.startsWith(OUT + sep)) return null;
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = pathname.startsWith('/api/') ? null : fileFor(pathname);
  const notFound = join(OUT, '404.html');
  const path = file ?? (existsSync(notFound) ? notFound : null);
  res.writeHead(file ? 200 : 404, {
    'Content-Type': path ? (TYPES[extname(path)] ?? 'application/octet-stream') : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : path ? readFileSync(path) : 'not found');
}).listen(port, () => {
  console.log(`serve-out: ${OUT}\n  http://localhost:${port}`);
});
