#!/usr/bin/env node
/**
 * Deploy the web app to its Cloudflare Pages project.
 *
 * Everything here is one of the failures in tsunagi-m-release section 5 - the
 * ones that print "Success", serve a working site, and are wrong.
 *
 *   5.1  `wrangler pages deploy <dir>` uploads <dir>, but collects Pages
 *        Functions from `./functions` RELATIVE TO THE CWD. A static
 *        environment that is not supposed to have a backend must ASSERT it has
 *        none, because the failure mode is a live API appearing under a URL
 *        whose entire purpose is to be a frozen candidate.
 *   5.2  Bindings are applied only when wrangler.jsonc's `name` matches
 *        --project-name. Pass a different one and they are skipped silently.
 *        So the name is READ from the config, never written twice.
 *   5.4  `--branch X` mints `X.<project>.pages.dev` forever. Pinning the branch
 *        to the project's production branch means every deploy lands on the
 *        bare apex and no alias is ever created.
 *
 * And one rule from this repository rather than the skill. CLAUDE.md: "CI does
 * not deploy unless the tests pass. Do not remove this gate." Section 1 puts
 * preview's deploy in a local script instead of CI, so the gate came with it -
 * the suite runs HERE, before anything is uploaded, and it runs inside the
 * script rather than beside it in package.json so that calling the script
 * directly cannot skip it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_BRANCH = 'main';

function die(msg) {
  console.error(`deploy: ${msg}`);
  process.exit(1);
}

/* ---- the project name comes from the config, once ------------------------ */
const configPath = join(WEB, 'wrangler.jsonc');
if (!existsSync(configPath)) die('wrangler.jsonc is missing; nothing says which project this is');
// JSONC: strip // comments before parsing. Block comments are not used here.
const raw = readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, '');
let config;
try {
  config = JSON.parse(raw);
} catch (e) {
  die(`wrangler.jsonc did not parse: ${e.message}`);
}
const project = config.name;
const outDir = config.pages_build_output_dir;
if (!project) die('wrangler.jsonc has no `name`');
if (!outDir) die('wrangler.jsonc has no `pages_build_output_dir`');

/* ---- 5.1: this environment has no backend, and must prove it ------------- */
const functionsDir = join(WEB, 'functions');
if (existsSync(functionsDir)) {
  die(
    `${functionsDir} exists. This project is a static export and must serve no API.\n` +
      '        wrangler would collect it from the CWD and publish it under this URL.\n' +
      '        Delete it, or deploy from a directory that is meant to have it.',
  );
}

/* ---- the gate: this app writes to an EEPROM ------------------------------ */
// Invoking the real scripts rather than transcribing what they do (section
// 5.6): a copy of another file's steps goes stale the moment that file gains
// one, and it fails silently - the deploy keeps working, just missing a stage.
function run(script) {
  console.log(`deploy: npm run ${script}`);
  execFileSync('npm', ['run', script], {
    cwd: WEB,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

run('test');
run('build');

/* ---- the build has to have run, and produced something ------------------- */
const out = join(WEB, outDir);
if (!existsSync(join(out, 'index.html'))) {
  die(`${out}/index.html is missing - run the build before deploying`);
}
if (!existsSync(join(out, 'manifest.webmanifest'))) {
  die(`${out}/manifest.webmanifest is missing - the export is incomplete`);
}

console.log(`deploy: project ${project}, branch ${PRODUCTION_BRANCH}, from ${outDir}/`);

execFileSync(
  'npx',
  [
    '-y',
    'wrangler@4',
    'pages',
    'deploy',
    outDir,
    `--project-name=${project}`,
    // 5.4: pinned, so no branch alias is ever minted.
    `--branch=${PRODUCTION_BRANCH}`,
  ],
  { cwd: WEB, stdio: 'inherit', shell: process.platform === 'win32' },
);
