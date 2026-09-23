#!/usr/bin/env node
/**
 * Deploy the owner preview to its Cloudflare Pages project - and refuse, before anything is built,
 * unless every one of these holds:
 *
 *   1. The project is the preview. Its name is READ from wrangler.jsonc (tsunagi-m-release 5.2:
 *      bindings apply only when the config's name matches --project-name, and a mismatch is
 *      silent), and it must be e46-m35080-migration-preview with RUNS_DB bound - otherwise every
 *      SYNC request answers 5xx.
 *   2. The gate is there. This used to REFUSE a functions/ directory, because the preview was a
 *      static export with no API. It is the opposite now: the whole origin is behind the owner gate
 *      (functions/_middleware.ts), and a preview without it would hand an unreleased EEPROM writer
 *      to anyone with the URL. `npm run gate:verify` proves the gate is tsunagi-m3's canonical copy.
 *   3. Nothing unpublishable is tracked (scripts/check-public-tree.mjs at the repository root).
 *   4. The tree is clean (scripts/tree-state.mjs - untracked files count; CLAUDE.md and .claude/
 *      are notes no build reads), and nothing gitignored sits under public/ or functions/: git does
 *      not show those, but the build copies public/ into out/ whole and wrangler uploads functions/,
 *      so a stray chip dump or .env there would ship.
 *   5. The source is PUBLIC. The operator's decision (2026-09-23): what is served as the preview is
 *      exactly a commit of github.com/mushitaro/e46-m35080-migration that anyone can read. So
 *      origin must be that repository, HEAD must equal origin/main after a fresh fetch, and GitHub
 *      must answer an anonymous caller that the repository is public and serves that commit.
 *   6. The tests pass. CLAUDE.md: this app writes to an EEPROM, so nothing deploys unless the tests
 *      pass, and that gate is not to be removed. It runs HERE, inside the script, so calling the
 *      script directly cannot skip it.
 *   7. The build is the branded preview of that commit: build:preview (next build → build-id →
 *      brand-preview → gen-sw → verify-export), every document app-variant=preview, no sync-token
 *      meta anywhere, and a build-id that is HEAD's clean `<count>.<sha>`.
 *
 * Then wrangler runs FROM web/ - it collects functions from its working directory (5.1), and
 * web/functions/ is the gate and the SYNC - with --branch pinned to main so no alias is ever minted
 * (5.4). Then scripts/verify-deploy.mjs reads the deployment back.
 *
 *   npm run deploy               everything, then upload
 *   npm run deploy -- --check    everything up to the upload, then stop
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirtyPaths } from './tree-state.mjs';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(WEB, '..');
const PREVIEW_PROJECT = 'e46-m35080-migration-preview';
const PUBLIC_BRANCH = 'main';
const REPO = 'mushitaro/e46-m35080-migration';
const REPO_REMOTE = /github\.com[:/]mushitaro\/e46-m35080-migration(\.git)?\/?$/i;
const CHECK_ONLY = process.argv.includes('--check');

function refuse(msg) {
  console.error(`deploy: REFUSED - ${msg}\n        Nothing was uploaded.`);
  process.exit(1);
}
const ok = (msg) => console.log(`ok    ${msg}`);
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// Invoking the real scripts rather than transcribing what they do (section 5.6): a copy of another
// file's steps goes stale the moment that file gains one, and it fails silently.
function run(cmd, args, cwd = WEB) {
  console.log(`deploy: ${cmd} ${args.join(' ')}`);
  try {
    execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

/* ---- 1. which project ------------------------------------------------------------------------ */
const configPath = join(WEB, 'wrangler.jsonc');
if (!existsSync(configPath)) refuse('wrangler.jsonc is missing; nothing says which project this is.');
let config;
try {
  // JSONC: strip whole-line // comments. Block comments are not used here.
  config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
} catch (e) {
  refuse(`wrangler.jsonc did not parse: ${e.message}`);
}
const project = config.name;
const outDir = config.pages_build_output_dir;
if (project !== PREVIEW_PROJECT) refuse(`wrangler.jsonc names "${project}". This repository deploys ${PREVIEW_PROJECT} and nothing else.`);
if (!outDir) refuse('wrangler.jsonc has no `pages_build_output_dir`.');
if (!config.d1_databases?.some((d) => d.binding === 'RUNS_DB')) refuse('wrangler.jsonc binds no RUNS_DB; every SYNC request would answer 5xx.');
ok(`project ${project}, RUNS_DB bound`);

/* ---- 2. the gate ----------------------------------------------------------------------------- */
if (!existsSync(join(WEB, 'functions', '_middleware.ts'))) {
  refuse('functions/_middleware.ts is missing. Without the owner gate the preview is open to anyone with the URL.');
}
if (!run('npm', ['run', 'gate:verify'])) refuse('npm run gate:verify failed: the gate is not the canonical one, or not wired.');
ok('owner gate present and canonical');

/* ---- 3. nothing unpublishable tracked --------------------------------------------------------- */
if (!run('node', ['scripts/check-public-tree.mjs'], ROOT)) refuse('scripts/check-public-tree.mjs found something that must not be public.');
ok('public tree');

/* ---- 4. a clean tree, and nothing ignored that would ship ------------------------------------ */
let dirty;
try {
  dirty = dirtyPaths(ROOT);
} catch {
  refuse('git status failed; the tree cannot be checked.');
}
if (dirty.length > 0) {
  refuse(`the working tree has changes (CLAUDE.md and .claude/ aside). Commit and push them first:\n        ${dirty.join('\n        ')}`);
}
const strays = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'public', 'functions'], {
  cwd: WEB,
  encoding: 'utf8',
})
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);
if (strays.length > 0) {
  refuse(`gitignored files under web/public or web/functions would be uploaded with the build:\n        ${strays.join('\n        ')}`);
}
ok('working tree clean; nothing ignored under public/ or functions/');

/* ---- 5. the source is public ------------------------------------------------------------------ */
let remote = '';
try {
  remote = git('remote', 'get-url', 'origin');
} catch {
  /* no remote */
}
if (!REPO_REMOTE.test(remote)) {
  refuse(`origin is "${remote || '(none)'}", not github.com/${REPO}. Only that public repository counts as published.`);
}
try {
  // The remote as it is now, not as the last fetch left it: a stale origin/main that happens to
  // equal HEAD would pass a commit that was never pushed.
  git('fetch', '--quiet', 'origin', PUBLIC_BRANCH);
} catch (e) {
  refuse(`could not fetch origin/${PUBLIC_BRANCH} (${String(e.stderr ?? e.message).trim()}). Not verified is not the same as public.`);
}
const head = git('rev-parse', 'HEAD');
const published = git('rev-parse', `origin/${PUBLIC_BRANCH}`);
if (head !== published) {
  refuse(`HEAD ${head.slice(0, 7)} is not origin/${PUBLIC_BRANCH} (${published.slice(0, 7)}). Push first: the preview serves only public source.`);
}
ok(`HEAD ${head.slice(0, 7)} is origin/${PUBLIC_BRANCH}`);

/** GitHub's answer to someone with no credentials: no Authorization header, whatever the environment holds. */
async function anonymousGitHub(pathname) {
  try {
    const r = await fetch(`https://api.github.com${pathname}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'e46-m35080-migration-deploy-guard' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    refuse(`could not ask GitHub whether ${REPO} is public (${e?.message ?? e}). Not verified is not the same as public.`);
  }
}
const repoAnswer = await anonymousGitHub(`/repos/${REPO}`);
if (repoAnswer.status !== 200 || repoAnswer.body?.private !== false || String(repoAnswer.body?.full_name).toLowerCase() !== REPO) {
  refuse(
    `GitHub does not show ${REPO} as a public repository to an anonymous caller (HTTP ${repoAnswer.status}, private: ${repoAnswer.body?.private}). ` +
      'Make it public, or wait out a rate limit; not verified is not the same as public.',
  );
}
const commitAnswer = await anonymousGitHub(`/repos/${REPO}/commits/${head}`);
if (commitAnswer.status !== 200 || commitAnswer.body?.sha !== head) {
  refuse(`GitHub does not serve commit ${head.slice(0, 7)} of ${REPO} to an anonymous caller (HTTP ${commitAnswer.status}). Push it first.`);
}
ok(`github.com/${REPO} is public and serves ${head.slice(0, 7)} without credentials`);

/* ---- 6. the gate CLAUDE.md requires: this app writes to an EEPROM ----------------------------- */
if (!run('npm', ['run', 'test'])) refuse('the tests failed. This app writes to an EEPROM; nothing deploys unless they pass.');
if (!run('npm', ['run', 'typecheck'])) refuse('typecheck failed (the app, or functions/).');
ok('tests and typecheck');

/* ---- 7. the branded preview of exactly this commit -------------------------------------------- */
if (!run('npm', ['run', 'build:preview'])) refuse('npm run build:preview failed (its last step, verify-export, says why).');
const out = join(WEB, outDir);
if (!existsSync(join(out, 'index.html'))) refuse(`${outDir}/index.html is missing.`);
const html = (function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
  });
})(out);
const rel = (ps) => ps.map((p) => relative(WEB, p)).join(', ');
const withToken = html.filter((p) => /<meta[^>]+name="sync-token"/.test(readFileSync(p, 'utf8')));
if (withToken.length > 0) refuse(`an HTML file carries a sync-token meta: ${rel(withToken)}`);
const unbranded = html.filter((p) => !readFileSync(p, 'utf8').includes('<meta name="app-variant" content="preview">'));
if (unbranded.length > 0) refuse(`HTML without app-variant=preview: ${rel(unbranded)}`);
const { buildId } = JSON.parse(readFileSync(join(out, 'version.json'), 'utf8'));
const clean = `${git('rev-list', '--count', 'HEAD')}.${git('rev-parse', '--short', 'HEAD')}`;
if (buildId !== clean) refuse(`build-id "${buildId}" is not the clean build of HEAD (${clean}).`);
if (git('rev-parse', 'HEAD') !== head) refuse('HEAD moved during the build.');
ok(`no sync-token; ${html.length} documents branded preview; build ${buildId}`);

if (CHECK_ONLY) {
  console.log('\ndeploy --check: every guard passed. Stopping before the upload.');
  process.exit(0);
}

/* ---- upload, from web/, pinned ------------------------------------------------------------------ */
console.log(`deploy: project ${project}, branch ${PUBLIC_BRANCH}, from ${outDir}/ with web/functions/`);
if (
  !run('npx', [
    '--yes',
    'wrangler@4',
    'pages',
    'deploy',
    outDir,
    `--project-name=${project}`,
    // 5.4: pinned, so no branch alias is ever minted.
    `--branch=${PUBLIC_BRANCH}`,
    `--commit-hash=${head}`,
    // CLAUDE.md and .claude/ may differ from HEAD and are deliberately outside the tree check.
    '--commit-dirty=true',
  ])
) {
  refuse('wrangler pages deploy failed.');
}

/* ---- read it back ------------------------------------------------------------------------------- */
// The edge can serve the previous bundle for a few seconds after "Success" (measured on the sibling
// apps): retried, each attempt printed. Exit 2 is "could not verify" (no session file) and is never
// retried - it would be the same every time.
for (let i = 1; i <= 3; i++) {
  console.log(`deploy: node scripts/verify-deploy.mjs https://${project}.pages.dev${i > 1 ? `   (attempt ${i}/3)` : ''}`);
  try {
    execFileSync('node', ['scripts/verify-deploy.mjs', `https://${project}.pages.dev`], { cwd: WEB, stdio: 'inherit' });
    process.exit(0);
  } catch (e) {
    if (e.status === 2) {
      console.error('\ndeploy: uploaded, but NOT VERIFIED (see above).');
      process.exit(2);
    }
    if (i === 3) {
      console.error('\ndeploy: uploaded, and the read-back FAILED.');
      process.exit(1);
    }
    execFileSync('node', ['-e', 'setTimeout(()=>{}, 8000)']);
  }
}
