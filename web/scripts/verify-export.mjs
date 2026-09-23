/**
 * Checks the export before it is allowed to be deployed. Runs last in `npm run build` and
 * `npm run build:preview`, after build-id.mjs, brand-preview.mjs and gen-sw.mjs.
 *
 * Ported from E46M3-Diagnosis. Everything here is a failure that has happened to one of these apps,
 * or that the build's ordering makes possible. They share a shape: the build reports success, the
 * artefact is wrong, and nothing says so until a device is on the bench.
 *
 * Icon references in this app are relative (`./icons/...`, see brand-preview.mjs); they are
 * compared here as the root paths they resolve to from the page at `/`.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OUT = 'out';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const rows = [];
const check = (name, ok, detail) => rows.push({ name, ok: !!ok, detail: String(detail ?? '') });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(OUT)) {
  console.error(`[FATAL] ${OUT}/ does not exist. Run \`next build\` first.`);
  process.exit(1);
}

const files = walk(OUT);
const urls = files.map((p) => '/' + relative(OUT, p).split(sep).join('/'));
const documents = urls.filter((u) => u.endsWith('.html'));
/** `./icons/x.png` or `/base/icons/x.png` → `/icons/x.png`: the file in out/ it names. */
const rootPath = (href) => (href.startsWith('./') ? href.slice(1) : BASE && href.startsWith(BASE) ? href.slice(BASE.length) : href);

// ---- 1. the service worker exists, is fully substituted, and keeps its promises ------------
const swPath = join(OUT, 'sw.js');
check('sw.js exists', existsSync(swPath), swPath);
const sw = existsSync(swPath) ? readFileSync(swPath, 'utf8') : '';
for (const placeholder of ['__CACHE_NAME__', '__BASE__', '__ASSETS__', '__DOCUMENTS__']) {
  check(`sw.js has no ${placeholder}`, sw && !sw.includes(placeholder), '');
}
// The gate's routes and the SYNC API must never be answered from the cache, and the bypass has to
// come BEFORE the navigate branch, or /_gate/start is served the app shell.
const bypassAt = sw.indexOf("url.pathname.startsWith('/_gate/')");
check(
  'sw.js lets /_gate/* and /api/* through to the network, ahead of navigations',
  bypassAt > 0 && sw.includes("url.pathname.startsWith('/api/')") && bypassAt < sw.indexOf("request.mode === 'navigate'"),
  '',
);
// An EEPROM writer never swaps its code under a page on its own, and never downloads an update
// while a page has the bridge connected.
check('sw.js never calls skipWaiting', !/\.skipWaiting\s*\(/.test(sw), '');
check('sw.js asks open pages whether they are busy before an install', sw.includes('anyPageBusy()'), '');
check('sw.js answers a failed navigation from the cache (opaqueredirect / non-2xx)', sw.includes("response.type !== 'opaqueredirect' && response.ok"), '');

// ---- 2. the cache name is this app's, and shaped like a content hash -----------------------
const cacheName = (sw.match(/const CACHE = ['"]([^'"]+)['"]/) || [])[1];
check('sw.js cache name is m35080-<12 hex>', /^m35080-[0-9a-f]{12}$/.test(cacheName || ''), cacheName || '(none)');

// ---- 3. the asset list is a list of assets -------------------------------------------------
let assets = [];
try {
  assets = JSON.parse((sw.match(/const ASSETS = (\[[\s\S]*?\n\]);/) || [])[1] || '[]');
} catch {
  /* reported by the checks below */
}
const assetPath = (a) => rootPath(a.url);
check('ASSETS is non-empty', assets.length > 0, `${assets.length} entries`);
check('ASSETS contains /index.html', assets.some((a) => assetPath(a) === '/index.html'), '');
check('ASSETS excludes sw.js and version.json', !assets.some((a) => ['/sw.js', '/version.json'].includes(assetPath(a))), '');
check('ASSETS excludes source maps', !assets.some((a) => a.url.endsWith('.map')), '');
check(
  'ASSETS excludes Pages configuration and .nojekyll',
  !assets.some((a) => ['/_headers', '/_routes.json', '/_redirects', '/.nojekyll'].includes(assetPath(a))),
  'the host never serves these, and one unanswerable entry fails the whole install',
);
check('every ASSETS entry exists on disk', assets.every((a) => urls.includes(assetPath(a))), '');
check(
  'every document is fetched from its extensionless URL',
  assets.filter((a) => a.url.endsWith('.html')).every((a) => typeof a.fetch === 'string' && !a.fetch.endsWith('.html')),
  assets
    .filter((a) => a.url.endsWith('.html'))
    .map((a) => `${a.url}←${a.fetch}`)
    .join(', '),
);
check('every ASSETS entry carries its byte size', assets.every((a) => Number.isInteger(a.bytes) && a.bytes >= 0), '');

let swDocuments = [];
try {
  swDocuments = JSON.parse((sw.match(/const DOCUMENTS = (\[[\s\S]*?\n\]);/) || [])[1] || '[]');
} catch {
  /* reported below */
}
const missingDocs = documents.filter((d) => !swDocuments.includes(BASE + d));
check('DOCUMENTS lists every exported .html', missingDocs.length === 0, missingDocs.join(', ') || `${swDocuments.length} documents`);

// ---- 4. exactly one build-id per document, and version.json agrees -------------------------
for (const doc of documents) {
  const html = readFileSync(join(OUT, doc.slice(1)), 'utf8');
  const n = (html.match(/<meta name="build-id"/g) || []).length;
  check(`exactly one build-id in ${doc}`, n === 1, `${n} found`);
}
const vPath = join(OUT, 'version.json');
check('version.json exists', existsSync(vPath), vPath);
if (existsSync(vPath)) {
  const v = JSON.parse(readFileSync(vPath, 'utf8'));
  const stamped = (readFileSync(join(OUT, 'index.html'), 'utf8').match(/name="build-id" content="([^"]*)"/) || [])[1];
  check('version.json buildId matches the stamped document', v.buildId === stamped, `${v.buildId} vs ${stamped}`);
}

// ---- 5. the icons, in every variant --------------------------------------------------------
// tsunagi-m-release section 4.1: a maskable icon is its own file, scaled into the circle a
// launcher crops to. This repository is the recorded incident - migration-512 declared as both
// `any` and `maskable`, 66 px past the circle.
const manifestPath = join(OUT, 'manifest.webmanifest');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { icons: [] };
const icons = manifest.icons ?? [];
const anySrc = new Set(icons.filter((i) => (i.purpose ?? 'any').split(/\s+/).includes('any')).map((i) => i.src));
const maskable = icons.filter((i) => (i.purpose ?? '').split(/\s+/).includes('maskable'));
check('manifest declares maskable icons', maskable.length > 0, `${maskable.length}`);
check(
  'no maskable entry reuses an "any" file',
  maskable.every((i) => !anySrc.has(i.src) && /-maskable-/.test(i.src)),
  maskable.map((i) => i.src).join(', '),
);
const missingIcons = icons.filter((i) => !urls.includes(rootPath(i.src))).map((i) => i.src);
check('every manifest icon exists in out/', missingIcons.length === 0, missingIcons.join(', ') || `${icons.length} icons`);
check('short_name is 12 characters or fewer', (manifest.short_name ?? '').length <= 12, manifest.short_name);

/** The icon files a document names: <link rel="icon" | "apple-touch-icon" ...>. */
const linkedIcons = (html) =>
  [...html.matchAll(/<link[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g)]
    .map((m) => (m[0].match(/href="([^"]+)"/) || [])[1])
    .filter(Boolean);

const index = readFileSync(join(OUT, 'index.html'), 'utf8');
const apple = linkedIcons(index).filter((h) => /apple|-256\.png$/.test(h));
check('apple-touch-icon is the 256', /<link rel="apple-touch-icon" href="[^"]*-256\.png"/.test(index), apple.join(', ') || '(none)');
check('favicon is the 32', /<link rel="icon" href="[^"]*-32\.png" sizes="32x32"/.test(index), '');

// ---- 6. production is unbranded; a branded build is branded all the way through ------------
const variants = new Set();
for (const doc of documents) {
  const html = readFileSync(join(OUT, doc.slice(1)), 'utf8');
  const tags = [...html.matchAll(/<meta name="app-variant" content="([^"]*)"/g)].map((m) => m[1]);
  if (tags.length > 1) check(`at most one app-variant in ${doc}`, false, `${tags.length} found`);
  tags.forEach((v) => variants.add(v));
  // There is no shared upload token in this app, and there must never be: it would publish a
  // write key in the page it guards.
  check(`no sync-token meta in ${doc}`, !/<meta name="sync-token"/.test(html), '');
}

const referenced = new Set(['/manifest.webmanifest', ...icons.map((i) => rootPath(i.src))]);
for (const doc of documents) linkedIcons(readFileSync(join(OUT, doc.slice(1)), 'utf8')).forEach((h) => referenced.add(rootPath(h)));
const texts = files.filter((p) => /\.(html|txt)$/.test(p)).map((p) => ({ p, text: readFileSync(p, 'utf8') }));
const rel = (p) => '/' + relative(OUT, p).split(sep).join('/');

if (variants.size === 0) {
  // Production: the build nobody branded. It must not wear, or name, the preview's icons.
  check('production: manifest name has no environment suffix', !/ — [A-Z0-9]+$/.test(manifest.name ?? ''), manifest.name);
  check('production: every manifest icon is from the production set', icons.every((i) => !/-dev-/.test(i.src)), icons.map((i) => i.src).join(', '));
  const devNamed = texts.filter(({ text }) => /icons\/[a-z0-9-]+?-dev-(?:maskable-)?\d+\.png/.test(text)).map(({ p }) => rel(p));
  check('production: no document or payload names a -dev- icon', devNamed.length === 0, devNamed.join(', ') || 'none');
} else {
  const [variant] = variants;
  const label = variant.toUpperCase();
  check(
    'one app-variant across every document',
    variants.size === 1 && documents.every((d) => readFileSync(join(OUT, d.slice(1)), 'utf8').includes(`<meta name="app-variant" content="${variant}">`)),
    [...variants].join(', '),
  );
  check(`manifest name ends " — ${label}"`, (manifest.name ?? '').endsWith(` — ${label}`), manifest.name);
  check(`manifest short_name starts "${label[0]} "`, (manifest.short_name ?? '').startsWith(`${label[0]} `), manifest.short_name);
  check(
    'every manifest icon is from the dev set',
    icons.every((i) => /-dev-/.test(i.src)),
    icons.filter((i) => !/-dev-/.test(i.src)).map((i) => i.src).join(', ') || 'all -dev-',
  );
  // A production icon still named anywhere comes back on the first client-side render of the head.
  const stale = texts
    .filter(({ text }) => /icons\/[a-z0-9-]+?-(?:maskable-)?\d+\.png/.test(text.replace(/icons\/[a-z0-9-]+?-dev-(?:maskable-)?\d+\.png/g, '')))
    .map(({ p }) => rel(p));
  check('no document or payload names a production icon', stale.length === 0, stale.join(', ') || 'none');
  const notDev = [...referenced].filter((h) => h !== '/manifest.webmanifest' && !/-dev-/.test(h));
  check('every linked icon is from the dev set', notDev.length === 0, notDev.join(', ') || 'all -dev-');
  const absent = [...referenced].filter((h) => !urls.includes(h));
  check('every referenced icon exists in out/', absent.length === 0, absent.join(', ') || `${referenced.size} files`);

  // The browser fetches the manifest and its icons WITHOUT cookies. The gate lets through only what
  // functions/_middleware.ts lists, so a referenced icon missing there installs iconless.
  const mw = existsSync('functions/_middleware.ts') ? readFileSync('functions/_middleware.ts', 'utf8') : '';
  const notPublic = [...referenced].filter((h) => !mw.includes(`'${h}'`));
  check('the gate serves every referenced icon without a session', notPublic.length === 0, notPublic.join(', ') || `${referenced.size} public paths`);
}

// ---- report ---------------------------------------------------------------------------------
const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
const failed = rows.filter((r) => !r.ok).length;
console.log(failed === 0 ? `[verify-export] ${rows.length} checks, all pass` : `[verify-export] ${failed} of ${rows.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
