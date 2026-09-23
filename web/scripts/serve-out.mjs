#!/usr/bin/env node
/**
 * `npm run serve:out`: serve the static export in out/ on this PC, to look at a build the way
 * `next dev` cannot show it - above all a PREVIEW build (`npm run build:preview`), the only one
 * that draws the experimental parts (REWRITE's CODING, the TEST mode).
 *
 * On PORT when something assigns one (the desktop app's preview pane does), else 5050 - the port
 * after this app's dev port. localhost is a secure context, so Web Serial works here in desktop
 * Chrome or Edge: the UNO and the K+DCAN cable can be used against this server as against the
 * deployed preview.
 *
 * THE REFERENCE DATA, as the preview serves it. /api/ref/<name> answers from REFDATA_OUT (default
 * C:\EDIABAS-derived\m35080-refdata - where tools/refdata/gen_refdata.py writes it, and where
 * upload-refdata.mjs reads it from), so on this PC CODING's definitions and TEST's names arrive
 * the way they do for a signed-in owner of the preview: without opening a file. The folder is
 * outside the repository and nothing here copies it anywhere. There is no owner gate here, so
 * this server answers the machine it runs on and nobody else: a request from any other address is
 * refused, whatever it asks for.
 *
 * What it is not: the preview. No gate, no SYNC, no functions - every other /api/ path is 404.
 * Nothing is cached (`no-store`), so a rebuild, or regenerated reference data, is what the next
 * reload shows.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'out');
const REFDATA = process.env.REFDATA_OUT || 'C:\\EDIABAS-derived\\m35080-refdata';
/** The names the app asks for - functions/_lib/refdata.ts serves the same two. */
const REF_NAMES = new Set(['kombi-coding', 'kombi-names']);
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

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res, req, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}

createServer((req, res) => {
  // No gate: this PC only.
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return send(res, req, 403, 'text/plain; charset=utf-8', 'this server answers its own machine only');
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');

  if (pathname.startsWith('/api/ref/')) {
    const name = pathname.slice('/api/ref/'.length);
    const file = join(REFDATA, `${name}.json`);
    if (!REF_NAMES.has(name) || !existsSync(file)) return send(res, req, 404, 'text/plain; charset=utf-8', 'no such reference data here');
    return send(res, req, 200, 'application/json; charset=utf-8', readFileSync(file));
  }

  const file = pathname.startsWith('/api/') ? null : fileFor(pathname);
  const notFound = join(OUT, '404.html');
  const path = file ?? (existsSync(notFound) ? notFound : null);
  send(res, req, file ? 200 : 404, path ? (TYPES[extname(path)] ?? 'application/octet-stream') : 'text/plain; charset=utf-8', path ? readFileSync(path) : 'not found');
}).listen(port, () => {
  const refs = [...REF_NAMES].map((n) => `${n}: ${existsSync(join(REFDATA, `${n}.json`)) ? 'served' : 'absent'}`).join(', ');
  console.log(`serve-out: ${OUT}\n  http://localhost:${port}\n  reference data from ${REFDATA} (${refs})`);
});
