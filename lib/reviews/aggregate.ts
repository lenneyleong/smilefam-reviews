import { z } from "zod";
import {
  contributesToAverage,
  displayablePhotos,
  type Review,
  ReviewSource,
} from "./schema";

/**
 * Every number rendered anywhere on the site comes from this file.
 *
 * Nothing is hardcoded in a component — `scripts/verify.ts` fails the build if
 * a bare review-count or rating numeral appears in app/ or components/. That
 * rule is what keeps the site's arithmetic auditable: a visitor who adds up the
 * per-source counts must land exactly on the headline total.
 */

/**
 * A product needs a meaningful sample before an average means anything.
 * Snow Serum Pen has 2 Stamped reviews and Toothpaste has 2 — a "5.0 out of 5"
 * from two people reads as fake and is statistically empty. Below this floor we
 * show the count and suppress the average.
 */
export const MIN_REVIEWS_FOR_AVERAGE = 10;

export const SourceStatsSchema = z.object({
  /** How many WE hold, post-filtering. Always the number shown in our UI. */
  harvestedCount: z.int().nonnegative(),
  ratedCount: z.int().nonnegative(),
  average: z.number().nullable(),
  withPhotoCount: z.int().nonnegative(),
  firstDate: z.string().nullable(),
  lastDate: z.string().nullable(),
  /**
   * What the PLATFORM says it has. Kept strictly separate from harvestedCount
   * so an unverified claim can never leak into a headline: platform figures are
   * only ever shown as an attributed secondary stat.
   */
  platformReportedCount: z.int().nonnegative().nullable(),
  platformReportedAverage: z.number().nullable(),
  /** platformReportedCount - harvestedCount, when both are known. */
  discrepancy: z.int().nullable(),
});

export const AggregatesSchema = z.object({
  generatedAt: z.iso.datetime(),
  lastSyncedAt: z.iso.datetime(),
  reviewsSha256: z.string().length(64),

  totals: z.object({
    reviewCount: z.int().nonnegative(),
    ratedReviewCount: z.int().nonnegative(),
    recommendationCount: z.int().nonnegative(),
    withPhotoCount: z.int().nonnegative(),
    photoCount: z.int().nonnegative(),
    verifiedBuyerCount: z.int().nonnegative(),
    uniqueContentCount: z.int().nonnegative(),
  }),

  weightedAverage: z.object({
    value: z.number().nullable(),
    n: z.int().nonnegative(),
    basis: z.string(),
  }),

  ratingDistribution: z.record(z.string(), z.int().nonnegative()),
  bySource: z.record(z.string(), SourceStatsSchema),
  byProduct: z.array(
    z.object({
      handle: z.string().nullable(),
      name: z.string(),
      url: z.url().nullable(),
      count: z.int().nonnegative(),
      average: z.number().nullable(),
      withPhotoCount: z.int().nonnegative(),
      showAverage: z.boolean(),
    }),
  ),

  dateRange: z.object({
    first: z.string().nullable(),
    last: z.string().nullable(),
  }),
});

export type Aggregates = z.infer<typeof AggregatesSchema>;
export type SourceStats = z.infer<typeof SourceStatsSchema>;

export type PlatformReported = Partial<
  Record<
    z.infer<typeof ReviewSource>,
    { count: number | null; average: number | null }
  >
>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function averageOf(reviews: Review[]): number | null {
  const rated = reviews.filter(contributesToAverage);
  if (rated.length === 0) return null;
  const sum = rated.reduce((acc, r) => acc + (r.rating ?? 0), 0);
  return round2(sum / rated.length);
}

export function computeAggregates(input: {
  reviews: Review[];
  reviewsSha256: string;
  generatedAt: string;
  lastSyncedAt: string;
  platformReported?: PlatformReported;
}): Aggregates {
  // Removed reviews stay in the corpus for audit, but never in a public number.
  const active = input.reviews.filter((r) => r.status === "active");

  const rated = active.filter(contributesToAverage);
  const withPhotos = active.filter((r) => displayablePhotos(r).length > 0);

  const ratingDistribution: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  for (const r of rated) {
    const bucket = String(Math.round(r.rating!));
    ratingDistribution[bucket] = (ratingDistribution[bucket] ?? 0) + 1;
  }

  const bySource: Record<string, SourceStats> = {};
  for (const source of ReviewSource.options) {
    const rows = active.filter((r) => r.source === source);
    const dates = rows.map((r) => r.date).sort();
    const reported = input.platformReported?.[source];
    const platformReportedCount = reported?.count ?? null;

    bySource[source] = {
      harvestedCount: rows.length,
      ratedCount: rows.filter(contributesToAverage).length,
      average: averageOf(rows),
      withPhotoCount: rows.filter((r) => displayablePhotos(r).length > 0).length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      platformReportedCount,
      platformReportedAverage: reported?.average ?? null,
      discrepancy:
        platformReportedCount === null
          ? null
          : platformReportedCount - rows.length,
    };
  }

  const productMap = new Map<string, Review[]>();
  for (const r of active) {
    const key = r.product?.handle ?? r.product?.name ?? "__unattributed__";
    const list = productMap.get(key);
    if (list) list.push(r);
    else productMap.set(key, [r]);
  }

  const byProduct = [...productMap.entries()]
    .filter(([key]) => key !== "__unattributed__")
    .map(([, rows]) => {
      const first = rows[0]!;
      const ratedCount = rows.filter(contributesToAverage).length;
      const showAverage = ratedCount >= MIN_REVIEWS_FOR_AVERAGE;
      return {
        handle: first.product?.handle ?? null,
        name: first.product?.name ?? "Unknown product",
        url: first.product?.url ?? null,
        count: rows.length,
        // Suppress at the data layer, not just in the component — a number that
        // shouldn't be shown shouldn't exist in the JSON either.
        average: showAverage ? averageOf(rows) : null,
        withPhotoCount: rows.filter((r) => displayablePhotos(r).length > 0)
          .length,
        showAverage,
      };
    })
    .sort((a, b) => b.count - a.count);

  const allDates = active.map((r) => r.date).sort();

  return AggregatesSchema.parse({
    generatedAt: input.generatedAt,
    lastSyncedAt: input.lastSyncedAt,
    reviewsSha256: input.reviewsSha256,
    totals: {
      reviewCount: active.length,
      ratedReviewCount: rated.length,
      recommendationCount: active.filter((r) => r.recommended === true).length,
      withPhotoCount: withPhotos.length,
      photoCount: active.reduce((n, r) => n + displayablePhotos(r).length, 0),
      verifiedBuyerCount: active.filter((r) => r.verifiedBuyer).length,
      uniqueContentCount: new Set(active.map((r) => r.contentKey)).size,
    },
    weightedAverage: {
      value: averageOf(active),
      n: rated.length,
      basis:
        "Rated reviews only. Facebook recommendations carry no star rating and are excluded.",
    },
    ratingDistribution,
    bySource,
    byProduct,
    dateRange: {
      first: allDates[0] ?? null,
      last: allDates[allDates.length - 1] ?? null,
    },
  });
}
