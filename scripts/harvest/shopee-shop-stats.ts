import "../env";

import path from "node:path";
import { z } from "zod";

import { getJson } from "../lib/http";
import { loadHarvestState } from "../lib/harvest-state";
import { readJsonIfExists, writeJsonAtomic } from "../lib/snapshot";

/**
 * Shopee's public shop-detail endpoint. Free, unauthenticated, and it does two
 * jobs:
 *
 *   1. Gives the real platform-reported rating breakdown (good/normal/bad),
 *      which is where the site's non-five-star evidence comes from — the entire
 *      Stamped corpus is 5.0, so without Shopee there is nothing critical to
 *      show, and a review site with no critical reviews is not believable.
 *
 *   2. Acts as the free change-detection gate for the PAID Shopee review
 *      scrape. If the rating counts are unchanged since the last paid harvest,
 *      the Apify actor is skipped and the refresh costs $0 instead of ~$1.94.
 *
 * Gate design note (this fixed a real bug): an earlier version compared a fresh
 * fetch against this file's just-overwritten contents, so the gate ALWAYS read
 * "unchanged" and the paid scrape could never trigger. The baseline must
 * survive stats refreshes, so:
 *
 *   - the authoritative baseline is `shopeeRatingTotal` in
 *     data/harvest-state.json, written only after a successful PAID harvest;
 *   - this file additionally persists `previousRatingTotal` (the total at the
 *     previous stats run) as a fallback for a state file that predates the
 *     first paid run.
 */

const SHOP_ID = "1362689438";
const OUT = path.join("data", "shopee-shop-stats.json");

const ShopDetailSchema = z.object({
  data: z.object({
    shopid: z.number(),
    name: z.string().nullish(),
    rating_star: z.number().nullish(),
    rating_good: z.number().nullish(),
    rating_normal: z.number().nullish(),
    rating_bad: z.number().nullish(),
    item_count: z.number().nullish(),
    follower_count: z.number().nullish(),
    is_official_shop: z.boolean().nullish(),
  }),
});

export const ShopeeShopStatsSchema = z.object({
  fetchedAt: z.iso.datetime(),
  shopId: z.string(),
  name: z.string().nullable(),
  ratingStar: z.number().nullable(),
  ratingGood: z.number().nullable(),
  ratingNormal: z.number().nullable(),
  ratingBad: z.number().nullable(),
  /** good + normal + bad. The gate compares this between runs. */
  ratingTotal: z.number().nullable(),
  itemCount: z.number().nullable(),
  followerCount: z.number().nullable(),
  isOfficialShop: z.boolean().nullable(),
  /**
   * ratingTotal at the PREVIOUS stats run. Persisted so refreshing this file
   * cannot destroy the change-detection baseline (the bug described above).
   * Default null so stats files written before this field existed still parse.
   */
  previousRatingTotal: z.number().nullable().default(null),
});
export type ShopeeShopStats = z.infer<typeof ShopeeShopStatsSchema>;

export function loadShopeeShopStats(): ShopeeShopStats | null {
  const raw = readJsonIfExists<unknown>(OUT);
  return raw ? ShopeeShopStatsSchema.parse(raw) : null;
}

export async function fetchShopeeShopStats(): Promise<ShopeeShopStats> {
  const payload = await getJson<unknown>(
    `https://shopee.sg/api/v4/shop/get_shop_detail?shopid=${SHOP_ID}`,
    {
      headers: {
        // Shopee's API rejects requests without a plausible referer.
        Referer: "https://shopee.sg/smilefam",
        "X-Requested-With": "XMLHttpRequest",
      },
    },
  );

  const { data } = ShopDetailSchema.parse(payload);
  const good = data.rating_good ?? null;
  const normal = data.rating_normal ?? null;
  const bad = data.rating_bad ?? null;

  return ShopeeShopStatsSchema.parse({
    fetchedAt: new Date().toISOString(),
    shopId: String(data.shopid),
    name: data.name ?? null,
    ratingStar: data.rating_star ?? null,
    ratingGood: good,
    ratingNormal: normal,
    ratingBad: bad,
    ratingTotal:
      good === null && normal === null && bad === null
        ? null
        : (good ?? 0) + (normal ?? 0) + (bad ?? 0),
    itemCount: data.item_count ?? null,
    followerCount: data.follower_count ?? null,
    isOfficialShop: data.is_official_shop ?? null,
    previousRatingTotal: null,
  });
}

/**
 * The rating total the paid scrape should be compared AGAINST.
 *
 * Only harvest-state's `shopeeRatingTotal` — the total recorded at the last
 * PAID harvest — may serve as a baseline. The stats file's
 * `previousRatingTotal` must never stand in for it: every free stats refresh
 * rewrites that field, so before the first paid run it equals the current
 * total and would make the gate report "unchanged" — silently blocking the
 * first-ever harvest. No paid harvest yet → null → the gate treats it as
 * "changed" and lets the run proceed.
 */
export function shopeeGateBaseline(): number | null {
  const state = loadHarvestState();
  return state.sources.shopee?.shopeeRatingTotal ?? null;
}

/**
 * True when the paid Shopee scrape is worth running: the current fetch differs
 * from the baseline, or no baseline exists yet.
 */
export function shopeeHasChanged(
  baselineRatingTotal: number | null,
  next: ShopeeShopStats,
): boolean {
  if (baselineRatingTotal === null) return true;
  return baselineRatingTotal !== next.ratingTotal;
}

export async function run(): Promise<void> {
  const previous = loadShopeeShopStats();
  const stats = await fetchShopeeShopStats();
  // Carry the OLD total forward so the change signal survives this write.
  writeJsonAtomic(OUT, {
    ...stats,
    previousRatingTotal: previous?.ratingTotal ?? null,
  });

  const baseline = shopeeGateBaseline() ?? previous?.ratingTotal ?? null;

  console.log(`Shopee shop ${stats.shopId} (${stats.name ?? "?"})`);
  console.log(`  rating:    ${stats.ratingStar?.toFixed(4) ?? "?"}`);
  console.log(
    `  breakdown: ${stats.ratingGood} good / ${stats.ratingNormal} normal / ${stats.ratingBad} bad`,
  );
  console.log(`  total:     ${stats.ratingTotal}`);
  console.log(`  items:     ${stats.itemCount}`);
  console.log(`  official:  ${stats.isOfficialShop}`);
  console.log(
    `  paid scrape due: ${shopeeHasChanged(baseline, stats)}` +
      (baseline === null
        ? " (no baseline — never paid-harvested)"
        : ` (baseline ${baseline})`),
  );
  console.log(`  → ${OUT}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
