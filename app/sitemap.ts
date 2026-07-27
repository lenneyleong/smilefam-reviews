import type { MetadataRoute } from "next";

import { FACETS, MAX_PAGES, PAGE_SIZE } from "@/lib/browse";
import { getAggregates, getAllReviews } from "@/lib/data";
import { SITE } from "@/lib/schema";

/**
 * The sitemap is an editorial statement of what matters, not a crawl dump.
 *
 * - Answer pages and facet fronts are all in.
 * - Pagination: every page of every list. Each deep page holds distinct
 *   reviews (all self-canonical), and the whole set is ~260 URLs — trivial
 *   against the 50k sitemap limit, and it saves crawlers a 20-hop walk.
 * - lastmod comes from the data's real sync time, shared across entries. A
 *   sitemap whose every URL "changed" at build time trains crawlers to ignore
 *   lastmod entirely, so it moves only when the data does.
 * - No changefreq/priority — Google ignores both.
 * - /all stays out: it is noindex by design.
 */

const SITEMAP_PAGE_CAP = MAX_PAGES;

export default function sitemap(): MetadataRoute.Sitemap {
  const aggregates = getAggregates();
  const lastModified = new Date(aggregates.lastSyncedAt);

  const entries: MetadataRoute.Sitemap = [];
  const add = (path: string) =>
    entries.push({ url: `${SITE}${path}`, lastModified });

  // Core
  add("/");
  add("/methodology");
  add("/about");
  add("/photos");

  // Answer pages — one per buyer question. New answer pages get added here.
  add("/is-smilefam-legit");
  add("/smilefam-complaints-and-negative-reviews");
  add("/does-smilefam-actually-work");
  add("/how-much-does-smilefam-cost");
  add("/where-to-buy-smilefam-in-singapore");

  // Review browser + pagination
  add("/reviews");
  const totalPages = Math.min(
    Math.ceil(getAllReviews().length / PAGE_SIZE),
    MAX_PAGES,
    SITEMAP_PAGE_CAP,
  );
  for (let n = 2; n <= totalPages; n += 1) add(`/reviews/page/${n}`);

  // Facets + their first few pages
  for (const facet of FACETS) {
    add(`/reviews/${facet.slug}`);
    if (facet.slug === "critical") continue; // critical is a single page
    const facetPages = Math.min(
      Math.ceil(facet.select().length / PAGE_SIZE),
      MAX_PAGES,
      SITEMAP_PAGE_CAP,
    );
    for (let n = 2; n <= facetPages; n += 1) {
      add(`/reviews/${facet.slug}/page/${n}`);
    }
  }

  return entries;
}
