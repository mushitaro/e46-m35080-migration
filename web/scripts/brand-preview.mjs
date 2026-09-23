/**
 * Brands an exported build as a non-production variant, so an install of it cannot be mistaken for
 * the release - on the home screen, in the install prompt, or in the app's own idea of itself.
 *
 *     node scripts/brand-preview.mjs <out-dir> <LABEL>        e.g.  out PREVIEW
 *
 * Runs AFTER `next build` and `build-id.mjs`, and BEFORE `gen-sw.mjs` (package.json
 * `build:preview`). gen-sw names the cache after a hash of the bytes; brand after it and two builds
 * differing only in branding share a cache name, and a device holding the first keeps serving it.
 *
 * Ported from E46M3-Diagnosis. Until this existed the PREVIEW identity was written into
 * layout.tsx, the manifest and public/sw.js, so a production build needed source edits and could
 * ship saying PREVIEW. Now the source - public/manifest.webmanifest and app/layout.tsx - is
 * PRODUCTION's identity and is never edited for a preview. This patches the bytes the compile
 * produced (tsunagi-m-release section 4.2), so the only thing that differs is here:
 *
 *   manifest.name         += " — <LABEL>"
 *   manifest.short_name    = "<LABEL[0]> <production short_name>"   (the home-screen label)
 *   manifest.description  += " — <LABEL> BUILD, not the production tool."
 *   every icon reference   → the M ICON dev set (white on black), maskable entries included
 *   every .html            : <meta name="app-variant" content="<label>">, removed then inserted;
 *                            apple-mobile-web-app-title rewritten where one is present
 *
 * theme_color and background_color are the app's ground and stay as they are. <title> is not
 * rewritten, on purpose: section 4.2 leaves it as the production name.
 *
 * ## Icon references are relative here
 *
 * This app writes `./icons/...` (a GitHub Pages basePath once needed it, and next.config.ts still
 * honours one), where the sibling apps write `/icons/...`. So the swap matches `icons/<file>`
 * whatever precedes it, which covers both spellings.
 *
 * ## Both arguments are required, and neither has a default
 *
 * A default is the value somebody forgot to pass, and the symptom would be two identically labelled
 * icons - the failure this script exists to prevent. LABEL is capped at 12 characters.
 *
 * ## The label decides `app-variant`, and that is not cosmetic
 *
 * lib/domain/variant.ts reads the tag back, and the preview-only surfaces - SYNC, the error
 * records, the PRIVACY link - open on the one value `preview`. Production carries no tag at all.
 *
 * ## Why the .txt files too
 *
 * Next's export writes the page's head a second time into its RSC payloads. A client-side render of
 * the head reads those, so a production icon left in one would come back. verify-export.mjs then
 * refuses a branded build in which any document still names a production icon.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const [OUT, LABEL] = process.argv.slice(2);
const fail = (msg) => {
  console.error(`[brand-preview] ${msg}`);
  process.exit(1);
};
if (!OUT || !LABEL) fail('usage: node scripts/brand-preview.mjs <out-dir> <LABEL>   (both required)');
if (LABEL.length > 12) fail(`LABEL "${LABEL}" is ${LABEL.length} characters; the limit is 12.`);
if (!/^[A-Z][A-Z0-9]*$/.test(LABEL)) fail(`LABEL "${LABEL}" must be upper-case letters and digits.`);
const VARIANT = LABEL.toLowerCase();

const manifestPath = join(OUT, 'manifest.webmanifest');
if (!existsSync(manifestPath)) fail(`${manifestPath} is missing — run next build first.`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Branding twice would append the label twice. `next build` copies a fresh manifest from public/
// every time, so a manifest that already says it is branded means this out/ was not rebuilt.
if (/ — [A-Z0-9]+$/.test(manifest.name)) fail(`${manifestPath} is already branded ("${manifest.name}"). Rebuild first.`);

/** `migration-192.png` → `migration-dev-192.png`, maskable included. Null for a dev file. */
const devOf = (file) => {
  const m = file.match(/^([a-z0-9]+(?:-[a-z0-9]+)*?)-((?:maskable-)?\d+\.png)$/);
  if (!m || m[1].endsWith('-dev')) return null;
  return `${m[1]}-dev-${m[2]}`;
};

// Every production icon in the export, and its dev twin - which must exist, or the branded build
// would point at a file that is not there.
const iconDir = join(OUT, 'icons');
if (!existsSync(iconDir)) fail(`${iconDir} is missing.`);
const swaps = new Map();
for (const name of readdirSync(iconDir)) {
  const dev = devOf(name);
  if (!dev) continue;
  if (!existsSync(join(iconDir, dev))) fail(`icons/${name} has no dev counterpart (icons/${dev}).`);
  swaps.set(`icons/${name}`, `icons/${dev}`);
}
if (swaps.size === 0) fail(`no production icons under ${iconDir} — nothing to brand.`);

const swapIcons = (text) => {
  let out = text;
  for (const [src, dev] of swaps) out = out.split(src).join(dev);
  return out;
};

// --- The manifest ------------------------------------------------------------------------------
const productionShort = manifest.short_name;
manifest.name = `${manifest.name} — ${LABEL}`;
manifest.short_name = `${LABEL[0]} ${productionShort}`;
if (manifest.short_name.length > 12) fail(`short_name "${manifest.short_name}" is over 12 characters.`);
manifest.description = `${manifest.description} — ${LABEL} BUILD, not the production tool.`;
manifest.icons = manifest.icons.map((icon) => {
  const src = swapIcons(icon.src);
  if (src === icon.src) fail(`manifest icon ${icon.src} has no dev counterpart.`);
  return { ...icon, src };
});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// --- Every document and RSC payload ------------------------------------------------------------
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

let documents = 0;
let payloads = 0;
for (const file of walk(OUT)) {
  const ext = extname(file);
  if (ext !== '.html' && ext !== '.txt') continue;
  const before = readFileSync(file, 'utf8');
  let after = swapIcons(before);
  if (ext === '.html') {
    after = after
      .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/g, `$1${manifest.short_name}$2`)
      // Removed, then inserted: out/ is not guaranteed fresh (build-id.mjs records the case), and
      // an insert-only stamp leaves two tags with the stale one first.
      .replace(/<meta name="app-variant" content="[^"]*"\s*\/?>/g, '');
    if (!after.includes('</head>')) fail(`${file} has no </head> to carry app-variant.`);
    after = after.replace('</head>', `<meta name="app-variant" content="${VARIANT}"></head>`);
    documents++;
  } else if (after !== before) {
    payloads++;
  }
  if (after !== before) writeFileSync(file, after);
}

console.log(
  `[brand-preview] ${OUT}: "${manifest.name}" / ${manifest.short_name} / app-variant=${VARIANT}; ` +
    `${swaps.size} icons → dev set; ${documents} document(s), ${payloads} RSC payload(s) patched`,
);
