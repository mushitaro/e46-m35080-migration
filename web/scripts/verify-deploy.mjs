/**
 * verify-deploy.mjs - read the deployment back from its URL.
 *
 *    GATE_SESSION_FILE=<file> CF_API_TOKEN=... CF_ACCOUNT_ID=... \
 *      node scripts/verify-deploy.mjs https://<host> [--expect=string]...
 *
 * Ported from E46M3-Diagnosis. It reads what is SERVED, not the build log: wrangler's "Success"
 * means bytes went up, and every silent failure in tsunagi-m-release passed that check.
 *
 * The preview sits behind the owner gate (functions/_middleware.ts), so there are two sides:
 *
 *   - No session (anyone): the gate is shut. A page load is a 302 to m3's authorize; /sw.js,
 *     /index.html, /version.json, /api/*, a real /_next/static chunk and a path that exists nowhere
 *     are all 401. Only the manifest and the icons it names answer 200, because a browser installs
 *     a PWA without cookies. If this side is open nothing else matters.
 *   - A session (an owner): the contents are right. The build-id matches the local build,
 *     app-variant=preview, the branded manifest and its -dev- and maskable icons, private caching,
 *     the SYNC routes answer lists, a route with no handler is 404 (5xx would mean the functions
 *     ran without their database - 5.1/5.2), the reference data is 200 or not-yet-uploaded 404
 *     and never cached, the worker is this app's, and a deployment-hash host answers 404 with no
 *     cookie set.
 *   - Fail closed (with CF_API_TOKEN and CF_ACCOUNT_ID, read-only): both deployment configs have
 *     fail_open=false, or when the Functions quota runs out Pages serves every asset ungated.
 *
 * The session is a short-lived one from tsunagi-m3's `access-session.mjs`, in the file named by
 * GATE_SESSION_FILE as {"token": "..."}. It is never on the command line and never printed. Without
 * a session or an API token the script checks what it can and SAYS it did not verify the rest:
 * exit 2, which deploy.mjs never retries. 1 is a failed check; 0 only when everything was checked.
 *
 * node:http(s), not fetch: the gate redirects only a PAGE LOAD (Sec-Fetch-Mode: navigate), and
 * Node's fetch sets every Sec- header itself - measured on MONITORING: GET / came back 401 through
 * fetch where a browser gets the 302.
 */
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('usage: GATE_SESSION_FILE=<file> node scripts/verify-deploy.mjs <https://host> [--expect=string]...');
  process.exit(2);
}
const expects = process.argv
  .slice(3)
  .filter((a) => a.startsWith('--expect='))
  .map((a) => a.slice(9));

/** The project this repository deploys to (wrangler.jsonc `name`, which deploy.mjs pins). */
const PROJECT = 'e46-m35080-migration-preview';
const EXPECT_NAME = 'E46 M35080 /// MIGRATION — PREVIEW';
const EXPECT_SHORT_NAME = 'P M35080';

const vpath = path.join(WEB, 'out', 'version.json');
const local = existsSync(vpath) ? JSON.parse(readFileSync(vpath, 'utf-8')) : null;

const rows = [];
const check = (name, ok, detail) => rows.push({ name, ok: !!ok, detail: String(detail ?? '') });

/** The owner session, from a file and never from the command line; only ever placed in a Cookie header. */
const sessionCookie = (() => {
  const file = process.env.GATE_SESSION_FILE;
  if (!file) return null;
  try {
    const token = JSON.parse(readFileSync(file, 'utf8')).token;
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? `__Host-owner=${token}` : null;
  } catch {
    return null;
  }
})();

/** One GET past every cache (a unique query string reaches the origin). */
const get = (p, { cookie = sessionCookie, navigate = false, host = null } = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(`${base}${p}${p.includes('?') ? '&' : '?'}cb=${process.hrtime.bigint()}`);
    const headers = { 'cache-control': 'no-cache' };
    if (host) headers.host = host; // node:https takes the TLS servername from this header too
    if (cookie) headers.cookie = cookie;
    if (navigate) Object.assign(headers, { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' });
    const req = (url.protocol === 'https:' ? https : http).get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const h = res.headers;
        resolve({
          status,
          headers: { get: (name) => [h[name.toLowerCase()]].flat().filter(Boolean).join(', ') || null },
          text: status < 400 ? Buffer.concat(chunks).toString('utf8') : '',
          location: String(h.location ?? ''),
          setsCookie: (h['set-cookie'] ?? []).length > 0,
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });

// ---- the Cloudflare API, read-only -----------------------------------------------------------
const cfToken = process.env.CF_API_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT_ID || '';
const cfReady = Boolean(cfToken && cfAccount);
const cf = async (p) => {
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccount)}${p}`, {
      headers: { authorization: `Bearer ${cfToken}` },
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.success) return { error: `HTTP ${r.status}${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ''}` };
    return { result: body.result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};
const unverified = [];

if (cfReady) {
  const project = await cf(`/pages/projects/${PROJECT}`);
  for (const env of ['production', 'preview']) {
    const v = project.result?.deployment_configs?.[env]?.fail_open;
    check(`Fail closed: deployment_configs.${env}.fail_open is false`, v === false, project.error ?? `fail_open = ${v === undefined ? '(absent)' : JSON.stringify(v)}`);
  }
} else {
  unverified.push('Fail closed (no CF_API_TOKEN / CF_ACCOUNT_ID)');
}

// ---- without a session: the gate is shut -----------------------------------------------------
const anonHome = await get('/', { cookie: null, navigate: true });
check(
  'no session: GET / is 302 to m3 authorize for m35080-preview',
  anonHome.status === 302 && /^https:\/\/m3\.tsunagi\.app\/api\/access\/authorize\?/.test(anonHome.location) && anonHome.location.includes('client_id=m35080-preview'),
  `${anonHome.status} ${anonHome.location.split('?')[0]}`,
);
for (const p of ['/sw.js', '/index.html', '/version.json', '/api/sessions', '/api/diagnostics', '/api/ref/kombi-coding', '/icons/migration-192.png']) {
  const r = await get(p, { cookie: null });
  check(`no session: ${p} is 401`, r.status === 401, String(r.status));
}
const home = sessionCookie ? await get('/', { navigate: true }) : null;
const chunkSource =
  home?.status === 200
    ? { from: 'served HTML', html: home.text }
    : existsSync(path.join(WEB, 'out', 'index.html'))
      ? { from: 'local out/index.html', html: readFileSync(path.join(WEB, 'out', 'index.html'), 'utf8') }
      : null;
const chunk = (chunkSource?.html.match(/\/_next\/static\/[^"'\s<>?]+\.js/) || [])[0];
if (chunk) {
  const r = await get(chunk, { cookie: null });
  check('no session: a real /_next/static chunk is 401', r.status === 401, `${r.status} ${chunk} (from ${chunkSource.from})`);
} else {
  check('no session: a real /_next/static chunk is 401', false, 'no chunk to try');
}
const noChunk = `/_next/static/chunks/verify-deploy-${process.pid}-does-not-exist.js`;
check('no session: a nonexistent /_next/static path is 401', (await get(noChunk, { cookie: null })).status === 401, noChunk);

const anonManifest = await get('/manifest.webmanifest', { cookie: null });
check('no session: manifest is 200', anonManifest.status === 200, String(anonManifest.status));
let manifest = null;
try {
  manifest = JSON.parse(anonManifest.text);
} catch {
  /* reported below */
}
const icons = manifest?.icons ?? [];
const abs = (src) => (src.startsWith('./') ? src.slice(1) : src);
for (const icon of icons) {
  const r = await get(abs(icon.src), { cookie: null });
  check(`no session: ${abs(icon.src)} is 200`, r.status === 200 && (r.headers.get('content-type') || '').includes('image/png'), `${r.status} ${r.headers.get('content-type') || ''}`);
}
check(`manifest name is ${EXPECT_NAME}`, manifest?.name === EXPECT_NAME, manifest?.name ?? '(unreadable)');
check(`manifest short_name is ${EXPECT_SHORT_NAME}`, manifest?.short_name === EXPECT_SHORT_NAME, manifest?.short_name ?? '(unreadable)');
check('every manifest icon is from the dev set', icons.length > 0 && icons.every((i) => /-dev-/.test(i.src)), icons.map((i) => i.src).join(', ') || '(none)');
const anySrc = new Set(icons.filter((i) => (i.purpose ?? 'any').split(/\s+/).includes('any')).map((i) => i.src));
const maskable = icons.filter((i) => (i.purpose ?? '').split(/\s+/).includes('maskable'));
check('maskable icons are their own files', maskable.length > 0 && maskable.every((i) => /-maskable-/.test(i.src) && !anySrc.has(i.src)), maskable.map((i) => i.src).join(', ') || '(none)');

function finish() {
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
  const failed = rows.filter((r) => !r.ok).length;
  if (failed) {
    console.error(`\n[FAIL] ${failed} of ${rows.length} checks`);
    process.exit(1);
  }
  if (unverified.length) {
    console.error(`\n[verify-deploy] ${rows.length} checks pass. NOT VERIFIED:`);
    for (const u of unverified) console.error(`  - ${u}`);
    if (!sessionCookie) console.error('  Pass an owner session (tsunagi-m3 access-session.mjs) in GATE_SESSION_FILE, and revoke it afterwards.');
    process.exit(2);
  }
  console.log(`\n[verify-deploy] ${rows.length} checks, all pass`);
  process.exit(0);
}

if (!sessionCookie) {
  unverified.push('the contents - build-id, app-variant, SYNC, the worker, the hash host (no GATE_SESSION_FILE)');
  finish();
}

// ---- with a session: what is inside is right --------------------------------------------------
check('GET / is 200', home.status === 200, `${home.status}${home.location ? ` → ${home.location.split('?')[0]}` : ''}`);
const bid = (home.text.match(/name="build-id" content="([^"]*)"/) || [])[1];
check('build-id present', !!bid, bid || '(missing: the stamping step did not run)');
if (local) check('build-id matches the local build', bid === local.buildId, `served ${bid} / local ${local.buildId}`);
else check('local out/version.json exists', false, 'run npm run build:preview first - nothing to compare against');
const variant = (home.text.match(/<meta name="app-variant" content="([^"]*)"/) || [])[1];
check('app-variant is preview', variant === 'preview', variant ?? '(absent: the build was not branded)');
check('no sync-token meta', !/<meta[^>]+name="sync-token"/.test(home.text), '');
check('/ is private', /private/.test(home.headers.get('cache-control') || ''), home.headers.get('cache-control') || '(none)');
const pp = home.headers.get('permissions-policy') || '';
check('Permissions-Policy allows serial', pp.includes('serial=(self)'), pp || '(none)');

const sessions = await get('/api/sessions');
let list = null;
try {
  list = JSON.parse(sessions.text).sessions;
} catch {
  /* reported below */
}
check('/api/sessions is 200 with a list', sessions.status === 200 && Array.isArray(list), `${sessions.status}${Array.isArray(list) ? `, ${list.length} row(s)` : ''}`);
const diags = await get('/api/diagnostics');
check('/api/diagnostics is 200', diags.status === 200, String(diags.status));
check('/api/info is 404', (await get('/api/info')).status === 404, 'a route with no handler; 5xx would mean no database');

// The reference data (functions/_lib/refdata.ts): 200 once the operator has uploaded it, 404 until
// then - never 5xx, which would mean the REFDATA binding is missing - and never cached anywhere.
for (const name of ['kombi-coding', 'kombi-names']) {
  const r = await get(`/api/ref/${name}`);
  check(`/api/ref/${name} is 200 or 404`, r.status === 200 || r.status === 404, `${r.status}${r.status === 404 ? ' (not uploaded yet: node scripts/upload-refdata.mjs)' : ''}`);
  const cc = r.headers.get('cache-control') || '';
  check(`/api/ref/${name} is private, no-store`, /private/.test(cc) && /no-store/.test(cc), cc || '(none)');
}
check('/api/ref/<not a served name> is 404', (await get('/api/ref/not-a-name')).status === 404, '');

const sw = await get('/sw.js');
const cache = (sw.text.match(/const CACHE = ['"]([^'"]+)['"]/) || [])[1];
check('sw.js cache name is m35080-<12 hex>', /^m35080-[0-9a-f]{12}$/.test(cache || ''), cache || '(none)');
check(
  'sw.js lets /_gate/ and /api/ through',
  sw.text.includes("url.pathname.startsWith('/_gate/')") && sw.text.includes("url.pathname.startsWith('/api/')"),
  '',
);

// A deployment hash is this project too, on a host the gate must not answer: 404, session or not,
// and no cookie set there. A REAL hash is the test - Pages itself 404s a made-up one - so it comes
// from the API when there is a token.
const baseIsLocal = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
let hashHost = null;
if (cfReady) {
  const deps = await cf(`/pages/projects/${PROJECT}/deployments?env=production`);
  const url = (deps.result ?? []).find((d) => d.environment === 'production' && d.url)?.url;
  if (url) hashHost = new URL(url).host;
  else check('a deployment hash host to test', false, deps.error ?? 'the API listed no production deployment');
} else if (baseIsLocal) {
  hashHost = `${process.pid.toString(16).padStart(8, '0').slice(-8)}.${PROJECT}.pages.dev`;
} else {
  unverified.push('the deployment hash host (no CF_API_TOKEN to name a real one)');
}
if (hashHost) {
  const r = await get('/', { navigate: true, host: hashHost }).catch((e) => ({ error: e.message }));
  check('a deployment hash host is 404 even with a session', r.status === 404 && !r.setsCookie, `${r.error ?? `${r.status}${r.setsCookie ? ', SETS A COOKIE' : ''}`} ${hashHost}`);
}

for (const e of expects) {
  const found = home.text.includes(e) || sw.text.includes(e);
  check(`served bundle contains "${e}"`, found, found ? 'yes' : 'NO: old code is being served');
}

finish();
