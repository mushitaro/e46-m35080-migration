#!/usr/bin/env node
//
// Resolve every AliExpress product id in the bills of materials - data/parts.json (the chip
// bench) and data/bench-parts.json (TEST's cluster bench) - to a title, price and affiliate
// link, and write data/aliexpress.json, which IS committed. One cache for both lists: the
// parts list reads it by product id, whichever list the part is on.
//
//   node --env-file=.env.local scripts/sync-aliexpress.mjs
//   node --env-file=.env.local scripts/sync-aliexpress.mjs --dry
//
// Ported from tsunagi-m3/scripts/sync-aliexpress.mjs. The signing, batching and
// link.generate fallback are unchanged - they are in production use there. What
// differs is where the product ids come from: that app scans posts/ for links,
// this one reads a bill of materials.
//
// Why a committed cache rather than fetching during `next build`:
//   - the build stays hermetic. CI needs no API secret, and a deploy cannot
//     fail because AliExpress is slow or down.
//   - prices land in git with a fetch date, so a stale price is visible in the
//     diff instead of silently ageing on a statically-built page. Showing a
//     price with no indication of when it was true is the thing 景表法 cares
//     about; `fetchedAt` is what the page dates itself from.
//   - the affiliate API is rate-limited; a rebuild should not spend quota.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.join(import.meta.dirname, '..');
const MANIFESTS = ['parts.json', 'bench-parts.json'].map((f) => path.join(ROOT, 'data', f));
const OUT = path.join(ROOT, 'data', 'aliexpress.json');
const DRY = process.argv.includes('--dry');

const APP_KEY = process.env.ALIEXPRESS_APP_KEY;
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET;
const TRACKING_ID = process.env.ALIEXPRESS_TRACKING_ID || 'default';

const ENDPOINT = 'https://api-sg.aliexpress.com/sync';

// Signature: HMAC-SHA256 over the parameters sorted by name and concatenated as
// k1v1k2v2..., keyed with the app secret, uppercase hex.
function call(method, appParams) {
  const params = {
    app_key: APP_KEY,
    method,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    format: 'json',
    v: '2.0',
    ...appParams,
  };
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  params.sign = crypto.createHmac('sha256', APP_SECRET).update(base).digest('hex').toUpperCase();

  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  }).then((r) => r.json());
}

const allParts = MANIFESTS.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).parts);
const withIds = allParts.filter((p) => p.productId);
const withoutIds = allParts.filter((p) => !p.productId);

console.log(`${allParts.length} parts: ${withIds.length} with a product id, ${withoutIds.length} without`);
for (const p of withoutIds) {
  // Named, not silently skipped: a part with no id ships as a search term, and
  // that is a decision someone should be able to see rather than discover.
  console.log(`  - ${p.id}: no productId (will show the search term "${p.searchQuery}")`);
}

if (!withIds.length) {
  console.log('nothing to resolve.');
  process.exit(0);
}

// --dry is useful without credentials: it answers "what would this fetch?"
if (DRY && (!APP_KEY || !APP_SECRET)) {
  console.log('\n--dry without credentials: would resolve');
  for (const p of withIds) console.log(`  ${p.productId}  (${p.id})`);
  process.exit(0);
}

if (!APP_KEY || !APP_SECRET) {
  console.error('\nALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET missing.');
  console.error('Run with:  node --env-file=.env.local scripts/sync-aliexpress.mjs');
  process.exit(1);
}

// A part on both lists is one product: fetched once.
const ids = [...new Set(withIds.map((p) => String(p.productId)))];
const products = {};
const missing = [];

// productdetail.get takes a comma-separated batch.
for (let i = 0; i < ids.length; i += 20) {
  const batch = ids.slice(i, i + 20);
  const res = await call('aliexpress.affiliate.productdetail.get', {
    product_ids: batch.join(','),
    target_currency: 'JPY',
    target_language: 'JA',
    country: 'JP',
    tracking_id: TRACKING_ID,
  });
  const result = res?.aliexpress_affiliate_productdetail_get_response?.resp_result;
  if (result?.resp_code !== 200) {
    console.error('  productdetail.get failed:', JSON.stringify(res).slice(0, 300));
    process.exit(1);
  }
  const list = result.result?.products?.product ?? [];
  for (const p of Array.isArray(list) ? list : [list]) {
    products[String(p.product_id)] = {
      title: p.product_title ?? null,
      image: p.product_main_image_url ?? null,
      price: p.target_sale_price ?? null,
      currency: p.target_sale_price_currency ?? null,
      // The API hands back a ready-made affiliate link; no need to spend a
      // separate link.generate call on it.
      promotionLink: p.promotion_link || null,
      url: p.product_detail_url ?? null,
    };
  }
  for (const id of batch) if (!products[id]) missing.push(id);
}

// Anything the catalogue no longer carries: delisted, or not commissionable.
// Reported rather than silently dropped - the BOM still lists it.
for (const id of missing) {
  const part = withIds.find((p) => String(p.productId) === id);
  console.log(`  ! ${id} not in the affiliate catalogue (delisted?) — part "${part?.id}"`);
}

// A product with no promotion_link still needs one so the link can be affiliated.
for (const [id, p] of Object.entries(products)) {
  if (p.promotionLink) continue;
  const res = await call('aliexpress.affiliate.link.generate', {
    promotion_link_type: '0',
    source_values: `https://ja.aliexpress.com/item/${id}.html`,
    tracking_id: TRACKING_ID,
  });
  const link =
    res?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links
      ?.promotion_link?.[0]?.promotion_link;
  p.promotionLink = link ?? null;
  if (!link) console.log(`  ! ${id} link.generate returned nothing`);
}

const payload = {
  // Stamped once per sync so the page can say when the price was true.
  fetchedAt: new Date().toISOString(),
  trackingId: TRACKING_ID,
  products,
};

console.log(`\nresolved ${Object.keys(products).length}/${ids.length} products`);
for (const [id, p] of Object.entries(products)) {
  console.log(`  ${id}  ${p.price ?? '—'} ${p.currency ?? ''}  ${String(p.title).slice(0, 46)}`);
}

if (DRY) {
  console.log('\n--dry: not written');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
}
