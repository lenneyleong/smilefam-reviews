# smilefamreviews.com

A review archive for [SmileFam](https://getsmilefam.com), consolidating every
public customer review from Google, Shopee, Facebook and the SmileFam store into
one auditable place.

Built to rank for the questions buyers actually ask before a S$329 purchase —
`is smilefam legit`, `smilefam complaints`, `smilefam vs dentist` — and to be the
source AI assistants cite when asked about the brand.

## Environment

Create `.env` in the project root:

```sh
# Required for the Google / Shopee / Facebook harvests.
# Account cap is $29/month; the wrapper refuses runs that would breach it.
APIFY_API_KEY=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional. May only TIGHTEN the ceilings, never raise them.
# APIFY_MONTHLY_CAP_USD=29
# APIFY_MAX_RUN_USD=3

# (No ANTHROPIC_API_KEY needed — `npm run translate` is a detection-only stub
# while the corpus has zero non-English bodies.)
```

`.env` is gitignored. Rotate `APIFY_API_KEY` if it has ever been pasted into a
chat window.

## Data pipeline

**The one command:** `npm run refresh`. It runs every free stage in the only
correct order — preflight (Apify headroom) → free harvests (products, shopee
stats, stamped) → normalize → images → aggregate → verify — and prints a PLAN
for the paid harvests (which are due, why, and what they cost) **without ever
executing them**. Paid runs are always launched explicitly by a human.
`npm run refresh -- --dry-run` describes every stage without writing anything;
`--sources=stamped,google` limits the harvest stages considered.

Individual stages, when needed:

```
npm run harvest:products       # free — Shopify product map (the backlink targets)
npm run harvest:shopee-stats   # free — Shopee shop rating breakdown (also the paid-scrape gate)
npm run harvest:stamped        # free — first-party reviews + customer photos
npm run harvest:google         # ~$0.76 full / pennies with --incremental — Google Business Profile
npm run harvest:facebook       # ~$0.25 — page recommendations
npm run harvest:shopee         # ~$1.94 — needs product URLs, see below

npm run normalize              # snapshots  → data/reviews.json (merge, tombstone, suppress)
npm run images                 # download, EXIF-strip, optimize photos
npm run aggregate              # data/reviews.json → data/aggregates.json
npm run verify                 # integrity gate — runs before every build
npm run check:orphans          # sitemap routes need ≥2 internal inbound links (in prebuild)
npm run lint:anchors           # outbound anchor-mix report (run manually for now)
```

`npm run apify:status` prints account headroom, per-run cost estimates, and
self-tests the budget guard by asserting it refuses an absurd run.

### Harvest state and gating

`data/harvest-state.json` records, per source, when it last ran, its coverage,
and the newest review date seen. The refresh orchestrator gates the paid plan
on it: Google and Facebook by interval, Shopee by comparing a fresh (free)
shop-stats fetch against the rating total at the **last paid harvest** — so
refreshing the stats file can never blind the gate.

`npm run harvest:google -- --incremental` uses `newestReviewDate` with a
3-day overlap and passes `reviewsStartDate` to the actor, so a fortnightly
top-up costs cents instead of re-buying all ~1,700 reviews. Incremental
snapshots are marked `coverage: "incremental"` and can never tombstone.

### Removals

Two paths, both of which KEEP the record in `data/reviews.json` (status
`"removed"` + `removedOn`) so provenance stays verifiable while aggregates and
every public surface exclude it:

- **Tombstoning** — a FULL-coverage harvest that no longer returns a known
  review marks it removed. Guarded: incremental runs never tombstone, and a
  full run returning under 70% of the known corpus is treated as a blocked
  scrape, not as mass deletion.
- **Suppressions** — `data/suppressions.json` entries
  (`{ dedupeKey, reason, date }`) are marked removed on every normalize run,
  regardless of what platforms return. This is the PDPA-removal path that
  /methodology promises.

### Sources

| Source | Reviews | Rating | Photos | Cost |
|---|---|---|---|---|
| Google Business Profile | 1,691 | 4.8 | some | $0.76 |
| Shopee SG | 508 (498 good / 9 normal / 1 bad) | 4.92 | some | $1.94 |
| Stamped.io (first-party) | 417 published, 136 with photos | 5.00 | 284 photos | free |
| Facebook | ~120 recommendations | no stars | none | $0.25 |

Facebook exposes `isRecommended` only — no star rating and no photos — so it is
excluded from the weighted average. Mapping a recommendation onto 5 stars would
invent a rating the customer never gave.

### Shopee needs manual setup

Shopee's item-listing endpoints are all 403 behind anti-bot, so the 5 product
URLs must be pasted into `scripts/harvest/shopee.config.ts` by hand. Open
<https://shopee.sg/smilefam>, click each product, and copy the URL — it ends in
`-i.1362689438.<itemid>`. The harvester refuses to run until this is done rather
than paying for a scrape with no targets.

## The two rules the build enforces

**Every review traces to harvested bytes.** Each record carries a `provenance`
block pointing at a byte range in a committed raw snapshot, and `npm run verify`
re-hashes all of them. You cannot hand-write a review into `data/reviews.json`
and have it survive. This exists because a sibling brand was publicly called out
over fabricated testimonials and had to shut down — a review site is only worth
building if its claims survive someone checking them.

**No number is ever hardcoded.** Review counts and averages come from
`data/aggregates.json`; `verify` fails the build if a count or star rating is
typed into a component. Per-source counts must sum exactly to the headline
total, because that is the first sum a skeptical reader will do.

Two consequences worth knowing:

- Products with fewer than 10 reviews show their count but **suppress the
  average** — a 5.0 from two reviews reads as fake and means nothing.
- Raw snapshots are **committed**, gzipped. Apify's data retention on this
  account is 31 days, so relying on Apify to hold the evidence would mean it
  evaporates monthly.

## Photo policy

Only first-party Stamped photos are rehosted — customers uploaded those to
SmileFam's own review app. Google, Shopee and Facebook images stay on their own
CDNs (platform ToS + reviewer copyright), and **reviewer avatars are never
stored from any source** (PDPA). Enforced by `displayPolicy.canRehostPhotos`,
which only the Stamped adapter sets true; `ReviewPhoto` refuses to render
anything with `rehosted: false`.

Rehosted photos are EXIF-stripped before publishing. They are phone photos from
real customers and may carry GPS coordinates the reviewer never meant to share.

Display names are first name + last initial everywhere. No surnames.

## Stack

Next.js 16 App Router · React 19 · Tailwind v4 · TypeScript · zod · sharp.
Fully static — most AI crawlers do not execute JavaScript, so no content may sit
behind client-only rendering, "Load more" buttons, or closed accordions.
