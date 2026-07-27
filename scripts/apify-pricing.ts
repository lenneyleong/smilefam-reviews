/**
 * Committed price table for every Apify actor this project runs.
 *
 * Why this file exists: these actors are pay-per-event, and the operator can
 * change the price whenever they like. An actor silently repricing 8x is the
 * realistic way a $29/month cap gets burned in a single run — far more likely
 * than us miscounting reviews. `assertPricingUnchanged()` in apify.ts compares
 * the live price against these numbers and refuses to run on any drift.
 *
 * Prices verified 2026-07-27 against the BRONZE tier on this account.
 * If a refusal fires, re-verify the real price, update this table deliberately,
 * and note the change — do not just bump the number to make the error go away.
 */

export interface ActorPricing {
  actorId: string;
  slug: string;
  /** USD charged per review/result event. */
  perResultUsd: number;
  /** USD charged just to start a run. */
  perRunStartUsd: number;
  /** Extra USD per dataset item, where the actor charges it separately. */
  perDatasetItemUsd: number;
  verifiedOn: string;
  notes?: string;
}

export const ACTOR_PRICING = {
  google: {
    actorId: "Xb8osYTtOjlsgI6k9",
    slug: "compass/google-maps-reviews-scraper",
    perResultUsd: 0.00045,
    perRunStartUsd: 0.00005,
    perDatasetItemUsd: 0,
    verifiedOn: "2026-07-27",
    notes:
      "Returns textTranslated + originalLanguage, so Google translation is free. " +
      "Also returns reviewsCount, which is how we learn the true GBP total.",
  },
  facebook: {
    actorId: "dX3d80hsNMilEwjXG",
    slug: "apify/facebook-reviews-scraper",
    perResultUsd: 0.002,
    perRunStartUsd: 0.001,
    perDatasetItemUsd: 0,
    verifiedOn: "2026-07-27",
    notes:
      "Returns isRecommended only — no star rating and no review photos. " +
      "Excluded from the weighted average by design.",
  },
  shopee: {
    actorId: "vX1uhoJOlFc6UYe9N",
    slug: "zen-studio/shopee-product-reviews-scraper",
    perResultUsd: 0.00379,
    perRunStartUsd: 0.008,
    perDatasetItemUsd: 0.00001,
    verifiedOn: "2026-07-27",
    notes:
      "Needs explicit product URLs (-i.<shopid>.<itemid>); Shopee's search_items " +
      "endpoint is 403 behind anti-bot, so the 5 item URLs are configured by hand.",
  },
} as const satisfies Record<string, ActorPricing>;

export type ActorKey = keyof typeof ACTOR_PRICING;

/** Cost of a run before it happens. Drives the budget guard's refusal. */
export function estimateRunCostUsd(key: ActorKey, expectedResults: number): number {
  const p = ACTOR_PRICING[key];
  return (
    p.perRunStartUsd +
    expectedResults * p.perResultUsd +
    expectedResults * p.perDatasetItemUsd
  );
}

/** Account-level ceiling, overridable downward but never upward. */
export const DEFAULT_MONTHLY_CAP_USD = 29;

/**
 * Refuse to get closer than this to the cap. Leaves room for a retry and for
 * the gap between our estimate and Apify's actual metering.
 */
export const SAFETY_MARGIN_USD = 2;

/** Any single run above this needs an explicit --yes-spend <usd> on the CLI. */
export const DEFAULT_MAX_RUN_USD = 3;
