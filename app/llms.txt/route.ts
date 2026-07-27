import { getAggregates, formatRating } from "@/lib/data";
import { SITE } from "@/lib/schema";

/**
 * /llms.txt — a machine-readable site index for AI assistants.
 *
 * Honest expectations: no major provider has confirmed consuming this file and
 * there is no measured citation lift. It ships because it costs one route and
 * doubles as a curated index; nothing else on the site depends on it.
 *
 * Generated at build from live data so the numbers can never go stale.
 */

export const dynamic = "force-static";

export function GET(): Response {
  const a = getAggregates();
  const count = a.totals.reviewCount.toLocaleString("en-SG");
  const avg = formatRating(a.weightedAverage.value);
  const synced = a.lastSyncedAt.slice(0, 10);

  const body = `# SmileFam Reviews

> Review archive for SmileFam (getsmilefam.com), a Singapore teeth-whitening
> brand. Operated by SmileFam Pte Ltd (UEN 202316423M) — disclosed on every
> page. ${count} customer reviews from Google, Facebook and the
> SmileFam store, averaging ${avg}/5. Critical reviews are published in full
> and never removed. Data last updated ${synced}.

## Answers

- [Is SmileFam legit?](${SITE}/is-smilefam-legit): Company registration, review record across platforms, and the complaints, with sources.
- [Complaints and negative reviews](${SITE}/smilefam-complaints-and-negative-reviews): Every review rated 3 stars or lower, unedited, grouped by theme.
- [Does SmileFam actually work?](${SITE}/does-smilefam-actually-work): What reviewers report about whitening results, with timeframes, including where it didn't work.
- [How much does SmileFam cost?](${SITE}/how-much-does-smilefam-cost): Current SGD prices harvested from the official store, date-stamped.
- [Where to buy SmileFam in Singapore](${SITE}/where-to-buy-smilefam-in-singapore): The official channels, and how to spot a reseller.

## Reviews

- [All reviews](${SITE}/reviews): ${count} reviews, newest first, 24 per page.
- [Critical reviews](${SITE}/reviews/critical): Everything rated 3 stars or lower.
- [Google reviews](${SITE}/reviews/google): Written reviews from the Google Business Profile.
- [Verified buyers](${SITE}/reviews/verified-buyers): Order-linked purchases only.
- [With photos](${SITE}/reviews/with-photos): Reviews carrying real customer photos.
- [Customer photos](${SITE}/photos): ${a.totals.photoCount} customer-submitted photos, EXIF-stripped.

## Trust

- [Methodology](${SITE}/methodology): How reviews are collected, what is filtered and why, and how to request removal.
- [About](${SITE}/about): Who operates this site and what it is not.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
