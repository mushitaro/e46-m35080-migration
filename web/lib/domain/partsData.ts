/**
 * The bill of materials, joined to whatever the last AliExpress sync resolved.
 *
 * Both JSON files are imported directly rather than read with `fs`: this runs in
 * a client component, and the data is small and static. The sync output is
 * committed, so a page built from a fresh clone still renders - it just falls
 * back to search links for anything not yet resolved.
 */

import manifest from '@/data/parts.json';
import cache from '@/data/aliexpress.json';

export type PartId = string;

export type Part = {
  id: PartId;
  required: boolean;
  qty: number;
  note?: string;
  productId: string | null;
  searchQuery: string;
  url?: string;
};

export type ResolvedPart = Part & {
  /** From the sync, when it resolved. */
  title: string | null;
  image: string | null;
  price: string | null;
  currency: string | null;
  /** Where the button goes. Always present - falls back to a search. */
  href: string;
  /** True when `href` is a tracked affiliate link. Drives rel and disclosure. */
  affiliate: boolean;
};

type CachedProduct = {
  title: string | null;
  image: string | null;
  price: string | null;
  currency: string | null;
  promotionLink: string | null;
  url: string | null;
};

const products = (cache.products ?? {}) as Record<string, CachedProduct>;

/** ISO timestamp of the last sync - what a displayed price is true as of. */
export const priceFetchedAt: string | null = cache.fetchedAt ?? null;

/** AliExpress search, for a part whose product has not been chosen yet. */
export function searchUrl(query: string): string {
  const slug = encodeURIComponent(query.trim().replace(/\s+/g, '-'));
  return `https://ja.aliexpress.com/w/wholesale-${slug}.html`;
}

/** A tracked link is one that goes through the portal's redirector. */
export function isAffiliateUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'click.aliexpress.com' || host.endsWith('.click.aliexpress.com');
  } catch {
    return false;
  }
}

/**
 * rel for a link that opens in a new tab.
 *
 * "sponsored" is the disclosure Google asks for on paid links; the rest is the
 * usual target="_blank" hygiene, kept on unpaid links too.
 */
export function relFor(url: string): string {
  return isAffiliateUrl(url)
    ? 'sponsored noopener noreferrer'
    : 'noopener noreferrer';
}

export function resolvedParts(): ResolvedPart[] {
  return (manifest.parts as Part[]).map((part) => {
    const p = part.productId ? products[part.productId] : undefined;
    // Preference order: the tracked link, then the product page, then a search.
    // A part with no product chosen still gets somewhere useful to go.
    const href = p?.promotionLink || p?.url || part.url || searchUrl(part.searchQuery);
    return {
      ...part,
      title: p?.title ?? null,
      image: p?.image ?? null,
      price: p?.price ?? null,
      currency: p?.currency ?? null,
      href,
      affiliate: isAffiliateUrl(href),
    };
  });
}

/** True when any link on the page is paid - drives whether disclosure shows. */
export function hasAffiliateLinks(): boolean {
  return resolvedParts().some((p) => p.affiliate);
}
