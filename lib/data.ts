import "server-only";

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import aggregatesJson from "@/data/aggregates.json";
import productsJson from "@/data/products.json";
import reviewsJson from "@/data/reviews.json";
import shopeeShopStatsJson from "@/data/shopee-shop-stats.json";

import { AggregatesSchema, type Aggregates } from "./reviews/aggregate";
import {
  contributesToAverage,
  displayablePhotos,
  type Review,
  ReviewsFileSchema,
  type ReviewSource,
} from "./reviews/schema";

/**
 * The single entry point for review data.
 *
 * Validated once at module load, so a malformed corpus fails the build rather
 * than rendering a broken page. Everything downstream can treat these as
 * trustworthy.
 *
 * Never ship the whole corpus to the client — 1,874 records is roughly 600 KB.
 * Each page bakes only the reviews it renders into its own HTML at build time.
 */

const aggregates: Aggregates = AggregatesSchema.parse(aggregatesJson);
const allReviews: Review[] = ReviewsFileSchema.parse(reviewsJson).filter(
  (review) => review.status === "active",
);

export function getAggregates(): Aggregates {
  return aggregates;
}

export function getAllReviews(): Review[] {
  return allReviews;
}

export function getReviewsBySource(source: ReviewSource): Review[] {
  return allReviews.filter((review) => review.source === source);
}

/**
 * Reviews rated 3 stars or lower.
 *
 * These get their own indexable route. A review archive that shows only its
 * best ratings is indistinguishable from a marketing page, and both search
 * raters and LLM retrievers discount it accordingly. Publishing these is what
 * makes the other 1,800 believable.
 */
export function getCriticalReviews(): Review[] {
  return allReviews
    .filter((review) => review.rating !== null && review.rating <= 3)
    .sort((a, b) => (a.rating ?? 5) - (b.rating ?? 5));
}

export function getReviewsWithPhotos(): Review[] {
  return allReviews.filter((review) => displayablePhotos(review).length > 0);
}

export function getReviewsForProduct(handle: string): Review[] {
  return allReviews.filter((review) => review.product?.handle === handle);
}

export function getRatedReviews(): Review[] {
  return allReviews.filter(contributesToAverage);
}

/** Newest first. Used for the "recently added" surface. */
export function getRecentReviews(limit: number): Review[] {
  return [...allReviews]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

/**
 * Markers of promotional rather than organic writing.
 *
 * Some reviews in the store's own corpus read as seeded or affiliate copy —
 * checkmark feature lists, "highly recommended", closing calls to action. They
 * are real submissions and stay in the archive, but they must not be the first
 * thing a skeptical visitor reads: sorting by length alone actively promotes
 * them, because marketing copy is long.
 */
const PROMOTIONAL_MARKERS: RegExp[] = [
  /[✔✅☑️]/u,
  /\bhighly recommend/i,
  /\bshop now\b/i,
  /\bgrab (?:yours|it) now\b/i,
  /\bdon['’]t miss out\b/i,
  /\bbid (?:good ?bye|farewell)\b/i,
  /\buse (?:my |the )?code\b/i,
  /\bcomes with:\s/i,
  /\bworth \$?s?\$/i,
];

function promotionalScore(body: string): number {
  return PROMOTIONAL_MARKERS.reduce(
    (score, pattern) => score + (pattern.test(body) ? 1 : 0),
    0,
  );
}

/**
 * Reviews worth featuring.
 *
 * Ranked by: least promotional first, then photo count, then length.
 * Deliberately NOT filtered by rating — a specific four-star review teaches a
 * reader more than a three-word five-star one, and a page that only ever
 * features five stars is the pattern we are trying not to be.
 */
export function getSubstantialReviews(limit: number): Review[] {
  return [...allReviews]
    .filter((review) => review.body.length >= 140)
    .map((review) => ({ review, promo: promotionalScore(review.body) }))
    .sort((a, b) => {
      if (a.promo !== b.promo) return a.promo - b.promo;
      const photoDelta =
        displayablePhotos(b.review).length - displayablePhotos(a.review).length;
      if (photoDelta !== 0) return photoDelta;
      return b.review.body.length - a.review.body.length;
    })
    .slice(0, limit)
    .map((entry) => entry.review);
}

/** How many reviews read as promotional. Surfaced on /methodology. */
export function countPromotionalReviews(): number {
  return allReviews.filter((review) => promotionalScore(review.body) > 0).length;
}

/**
 * Reviews whose text matches a theme, best-first.
 *
 * Powers the evidence sections of the answer pages: every claim like "reviewers
 * report X" is followed by actual reviews that say X, selected by pattern
 * rather than hand-picked — so the selection is reproducible and the page
 * updates itself when the corpus does.
 */
export function searchReviews(
  pattern: RegExp,
  limit: number,
  options: { maxRating?: number; minLength?: number } = {},
): Review[] {
  const { maxRating, minLength = 80 } = options;
  return allReviews
    .filter(
      (review) =>
        pattern.test(review.body) &&
        review.body.length >= minLength &&
        (maxRating === undefined ||
          (review.rating !== null && review.rating <= maxRating)),
    )
    .sort((a, b) => b.body.length - a.body.length)
    .slice(0, limit);
}

export function countReviewsMatching(pattern: RegExp): number {
  return allReviews.filter((review) => pattern.test(review.body)).length;
}

const ProductsFileSchema = z.array(
  z.object({
    shopifyProductId: z.string(),
    title: z.string(),
    handle: z.string(),
    url: z.string(),
    productType: z.string().nullable(),
    skus: z.array(z.string()),
    priceSgd: z.string().nullable(),
  }),
);

/**
 * Live product catalogue, harvested from the store's own products.json. Prices
 * on answer pages come from here — harvested and date-stamped, never typed in.
 */
/**
 * When the product catalogue (and therefore every price on the site) was
 * actually fetched from the store. Falls back to the review sync time only if
 * the meta file predates this feature.
 */
export function getProductsFetchedAt(): string {
  const metaPath = path.join(process.cwd(), "data", "products.meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      fetchedAt?: string;
    };
    if (meta.fetchedAt) return meta.fetchedAt;
  }
  return aggregates.lastSyncedAt;
}

export function getProducts() {
  return ProductsFileSchema.parse(productsJson);
}

const ShopeeShopStatsSchema = z.object({
  fetchedAt: z.iso.datetime(),
  shopId: z.string(),
  name: z.string(),
  ratingStar: z.number().nullable(),
  ratingGood: z.number().nullable(),
  ratingNormal: z.number().nullable(),
  ratingBad: z.number().nullable(),
  ratingTotal: z.number().nullable(),
  itemCount: z.number().nullable(),
  followerCount: z.number().nullable(),
  isOfficialShop: z.boolean(),
});

export type ShopeeShopStats = z.infer<typeof ShopeeShopStatsSchema>;

/**
 * Shopee's OWN shop-level rating for the official SmileFam shop, fetched from
 * the platform and date-stamped. We hold no individual Shopee reviews — this
 * figure is only ever presented as platform-reported, never folded into the
 * site's review counts or averages.
 */
export function getShopeeShopStats(): ShopeeShopStats {
  return ShopeeShopStatsSchema.parse(shopeeShopStatsJson);
}

/** Committed snapshot files, for the methodology page's evidence list. */
export function getSnapshotManifest(): Array<{
  source: string;
  file: string;
  bytes: number;
}> {
  const rawDir = path.join(process.cwd(), "data", "raw");
  if (!fs.existsSync(rawDir)) return [];

  const out: Array<{ source: string; file: string; bytes: number }> = [];
  for (const dir of fs.readdirSync(rawDir)) {
    const full = path.join(rawDir, dir);
    if (!fs.statSync(full).isDirectory() || dir === "photos") continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith(".json.gz")) continue;
      out.push({
        source: file.replace(".json.gz", ""),
        file: path.join("data", "raw", dir, file),
        bytes: fs.statSync(path.join(full, file)).size,
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Formatting helpers — one place, so every page renders numbers identically. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-SG");
}

export function formatRating(n: number | null): string {
  return n === null ? "—" : n.toFixed(n % 1 === 0 ? 1 : 2);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  });
}
