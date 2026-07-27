import "../env";

import { z } from "zod";

import { runActor, updateLedgerSnapshot } from "../apify";
import { makeContentKey, makeDedupeKey } from "../../lib/reviews/dedupe";
import {
  type Review,
  ReviewSchema,
  SOURCE_LABELS,
  SOURCE_LISTING_URLS,
} from "../../lib/reviews/schema";
import { maskAuthorName, sha256, toDayString } from "../../lib/reviews/text";
import { loadHarvestState, recordHarvest, recordProbe } from "../lib/harvest-state";
import { makeSnapshotId, writeSnapshot } from "../lib/snapshot";

/**
 * Google Business Profile reviews via compass/google-maps-reviews-scraper.
 *
 * Place ID resolved from the short link Lenney supplied
 * (https://g.page/r/CRKvNCHM70X0EAE/review → placeid=ChIJKx3Kew8T2jEREq80IczvRfQ).
 *
 * Two modes:
 *   --probe   ~$0.0005. Pulls a single review purely to read `reviewsCount`,
 *             which is the real number of Google reviews. The brand claims
 *             "1,500+ Google Reviews · 4.9 Stars" but nothing on disk has ever
 *             backed that, so no headline number ships until this has run.
 *   (default) Full harvest, priced off whatever the probe found.
 *
 * This actor also returns `textTranslated` + `originalLanguage`, so Google
 * hands us translation for free and scripts/translate.ts never has to pay to
 * translate a Google review.
 */

const ADAPTER_VERSION = "google@1";
export const PLACE_ID = "ChIJKx3Kew8T2jEREq80IczvRfQ";

/**
 * Fields we keep.
 *
 * `personalData: true` is requested because with it off the actor suppresses
 * reviewer names entirely, and 1,691 reviews attributed to nobody reads as far
 * less credible than "Wei T." — on a site whose only asset is credibility, that
 * matters.
 *
 * But the full name is redacted to "First L." by `redactRow()` BEFORE the
 * snapshot is written, so no surname and no reviewer ID ever reaches disk or
 * git. Provenance hashes the review body, not the name, so masking here costs
 * nothing in verifiability.
 */
export const GoogleReviewSchema = z.object({
  reviewId: z.string(),
  reviewUrl: z.string().nullish(),
  name: z.string().nullish(),
  stars: z.number().nullish(),
  text: z.string().nullish(),
  textTranslated: z.string().nullish(),
  originalLanguage: z.string().nullish(),
  translatedLanguage: z.string().nullish(),
  publishedAtDate: z.string().nullish(),
  reviewImageUrls: z.array(z.string()).nullish(),
  responseFromOwnerText: z.string().nullish(),
  responseFromOwnerDate: z.string().nullish(),
  isLocalGuide: z.boolean().nullish(),
  /** Listing-level: the true total number of Google reviews. */
  reviewsCount: z.number().nullish(),
  totalScore: z.number().nullish(),
  placeId: z.string().nullish(),
  title: z.string().nullish(),
});

export type GoogleReview = z.infer<typeof GoogleReviewSchema>;

/**
 * Privacy redaction applied at the harvest boundary, before anything is
 * written to a committed snapshot.
 *
 * Google returns full reviewer names. Singapore's PDPA governs republishing
 * personal data, and these snapshots live in git forever — so the surname is
 * dropped here rather than at render time. Redacting at the edge means there is
 * no copy of the full name anywhere in the repo to leak later.
 *
 * Also strips any reviewer-photo or reviewer-id field the actor may include:
 * we never display avatars, so we never store them.
 */
export function redactRow(raw: Record<string, unknown>): Record<string, unknown> {
  const { display } = maskAuthorName(
    typeof raw.name === "string" ? raw.name : null,
  );

  const cleaned: Record<string, unknown> = { ...raw, name: display };
  for (const key of [
    "reviewerPhotoUrl",
    "reviewerId",
    "reviewerUrl",
    "reviewerNumberOfReviews",
  ] as const) {
    delete cleaned[key];
  }
  return cleaned;
}

/**
 * Map a harvested Google row onto the normalized Review shape.
 *
 * Reviews with no text are skipped by the caller: a bare star with no words is
 * real evidence of a rating but there is nothing to display, and inventing a
 * body for it would be fabrication. The gap between what Google reports (1,691)
 * and what we can display shows up as `discrepancy` in aggregates.json rather
 * than being quietly papered over.
 */
export function toReview(
  raw: GoogleReview,
  context: { snapshot: string; rawIndex: number; harvestedAt: string },
): Review | null {
  const body = (raw.textTranslated || raw.text || "").trim();
  if (!body) return null;

  const sourceId = raw.reviewId;
  const dateIso = raw.publishedAtDate
    ? new Date(raw.publishedAtDate).toISOString()
    : context.harvestedAt;

  // Names were already redacted to "First L." at the harvest boundary.
  const display = raw.name?.trim() || "Google reviewer";
  const wasTranslated = Boolean(raw.textTranslated && raw.originalLanguage !== "en");

  return ReviewSchema.parse({
    id: `google:${sourceId}`,
    dedupeKey: makeDedupeKey("google", sourceId),
    contentKey: makeContentKey({
      authorDisplay: display,
      rating: raw.stars ?? null,
      dateIso,
      body,
    }),
    source: "google",
    sourceId,
    // Google DOES return a per-review permalink — the earlier claim that it
    // came back null was wrong (verified: all 1,691 rows carry one). Use it;
    // it is the strongest citation link the site has. Listing URL as fallback.
    sourceUrl: raw.reviewUrl?.trim() || SOURCE_LISTING_URLS.google,
    sourceLabel: SOURCE_LABELS.google,
    author: {
      display,
      maskApplied: "first-name-initial",
      location: null,
      countryIso: null,
    },
    rating: raw.stars ?? null,
    recommended: null,
    title: null,
    body,
    bodyOriginal: wasTranslated ? (raw.text?.trim() ?? null) : null,
    bodyLanguage: "en",
    translated: wasTranslated,
    // Google translates for free — we never pay to translate these.
    translationSource: wasTranslated ? "platform" : "none",
    date: dateIso,
    datePrecision: "second",
    // Google reviews are about the business, not a specific SKU.
    product: null,
    // Google-hosted images are never rehosted (Maps ToS + reviewer copyright).
    photos: (raw.reviewImageUrls ?? []).map((url) => ({
      sha256: sha256(url),
      src: null,
      remoteUrl: url,
      width: null,
      height: null,
      blurDataUrl: null,
      rehosted: false,
    })),
    verifiedBuyer: false,
    verificationBasis: "unverified",
    merchantReply: raw.responseFromOwnerText?.trim()
      ? {
          body: raw.responseFromOwnerText.trim(),
          date: raw.responseFromOwnerDate
            ? new Date(raw.responseFromOwnerDate).toISOString()
            : null,
        }
      : null,
    helpfulCount: null,
    displayPolicy: {
      canRehostPhotos: false,
      canShowFullName: false,
      mustAttribute: true,
      attributionUrl: raw.reviewUrl?.trim() || SOURCE_LISTING_URLS.google,
    },
    provenance: {
      harvestedAt: context.harvestedAt,
      snapshot: context.snapshot,
      rawIndex: context.rawIndex,
      bodySha256: sha256(body),
      adapterVersion: ADAPTER_VERSION,
      apifyRunId: null,
    },
    status: "active",
    // "When WE first saw it" — the harvest day, not the review's own date.
    // (Pre-existing records keep their old review-date-derived values via merge.)
    firstSeenOn: toDayString(context.harvestedAt),
    lastSeenOn: toDayString(context.harvestedAt),
  });
}

interface ProbeResult {
  reviewsCount: number | null;
  totalScore: number | null;
  placeTitle: string | null;
  chargedUsd: number | null;
}

/** Cheap listing-level probe. Settles the count before we price a full run.
 * The result is cached in harvest-state so back-to-back runs don't re-pay. */
export async function probe(): Promise<ProbeResult> {
  const { items, usageTotalUsd } = await runActor<unknown, GoogleReview>({
    actorKey: "google",
    label: "google probe",
    expectedResults: 1,
    input: {
      placeIds: [PLACE_ID],
      maxReviews: 1,
      reviewsSort: "newest",
      language: "en",
      // Names are requested, then immediately redacted to "First L." by
      // redactRow() before the snapshot is written. See its comment.
      personalData: true,
    },
  });

  const first = items[0];
  const result: ProbeResult = {
    reviewsCount: first?.reviewsCount ?? null,
    totalScore: first?.totalScore ?? null,
    placeTitle: first?.title ?? null,
    chargedUsd: usageTotalUsd,
  };
  recordProbe({
    probedAt: new Date().toISOString(),
    reviewsCount: result.reviewsCount,
    totalScore: result.totalScore,
  });
  return result;
}

/** How long a cached probe count is trusted before a full run re-probes. */
const PROBE_CACHE_MAX_AGE_DAYS = 7;
/** Incremental overlap: re-fetch this many days before the newest known
 * review, so a review posted the same day as the last harvest is never lost. */
const INCREMENTAL_OVERLAP_DAYS = 3;
/** Observed posting rate on this listing, reviews/day. Drives sizing. */
const REVIEWS_PER_DAY = 1.55;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cached probe figures, or null when absent/stale/suppressed. */
function cachedProbe(maxAgeDays: number): {
  reviewsCount: number | null;
  totalScore: number | null;
} | null {
  const cached = loadHarvestState().sources.google?.probe;
  if (!cached) return null;
  if (Date.now() - Date.parse(cached.probedAt) > maxAgeDays * DAY_MS) return null;
  return { reviewsCount: cached.reviewsCount, totalScore: cached.totalScore };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isProbe = args.includes("--probe");
  const incremental = args.includes("--incremental");
  const noProbe = args.includes("--no-probe");
  const yesSpend = readYesSpend(args);

  if (isProbe) {
    console.log("Probing the Google Business Profile listing…\n");
    const result = await probe();

    console.log("\nGoogle Business Profile");
    console.log(`  place:          ${result.placeTitle ?? "(name not returned)"}`);
    console.log(`  place id:       ${PLACE_ID}`);
    console.log(`  REVIEW COUNT:   ${result.reviewsCount ?? "not returned"}`);
    console.log(`  average rating: ${result.totalScore ?? "not returned"}`);
    console.log(`  charged:        $${(result.chargedUsd ?? 0).toFixed(5)}`);

    if (result.reviewsCount !== null) {
      const { estimateRunCostUsd } = await import("../apify-pricing");
      const cost = estimateRunCostUsd("google", result.reviewsCount);
      console.log(
        `\n  full harvest of ${result.reviewsCount} reviews ≈ $${cost.toFixed(4)}`,
      );
    }
    return;
  }

  // Listing-level figures for the snapshot meta. Prefer the cached probe when
  // it is recent (or when --no-probe forbids spending on one) — the probe is
  // cheap but not free, and its numbers barely move week to week.
  let listing = cachedProbe(noProbe ? Number.POSITIVE_INFINITY : PROBE_CACHE_MAX_AGE_DAYS);
  if (!listing) {
    if (noProbe) {
      listing = { reviewsCount: null, totalScore: null };
    } else {
      const probed = await probe();
      listing = { reviewsCount: probed.reviewsCount, totalScore: probed.totalScore };
    }
  }
  const reviewsCount = listing.reviewsCount;

  // Sizing + date bound.
  let coverage: "full" | "incremental";
  let expected: number;
  let reviewsStartDate: string | null = null;

  if (incremental) {
    const newest = loadHarvestState().sources.google?.newestReviewDate;
    if (!newest) {
      throw new Error(
        "--incremental needs harvest-state's google.newestReviewDate, which is " +
          "missing. Run a full harvest first (or reseed data/harvest-state.json).",
      );
    }
    coverage = "incremental";
    const startMs = Date.parse(newest) - INCREMENTAL_OVERLAP_DAYS * DAY_MS;
    reviewsStartDate = new Date(startMs).toISOString();
    const daysSince = Math.max(1, Math.ceil((Date.now() - startMs) / DAY_MS));
    // Posting rate × window, doubled for headroom, floored at 50 so a quiet
    // fortnight still leaves room for a burst.
    expected = Math.max(50, Math.ceil(daysSince * REVIEWS_PER_DAY * 2));
  } else {
    coverage = "full";
    // Sized off the probe rather than a guess, with headroom so a listing that
    // grew since the probe doesn't get truncated.
    expected = Math.ceil((reviewsCount ?? 1500) * 1.1);
  }

  const harvestedAt = new Date().toISOString();
  const snapshotId = makeSnapshotId(new Date(harvestedAt));

  const { items, runId, usageTotalUsd } = await runActor<unknown, GoogleReview>({
    actorKey: "google",
    label: incremental ? "google incremental" : "google full",
    expectedResults: expected,
    yesSpendUsd: yesSpend,
    input: {
      placeIds: [PLACE_ID],
      maxReviews: expected,
      reviewsSort: "newest",
      language: "en",
      // Date-bounds the incremental run server-side; omitted on full runs.
      ...(reviewsStartDate ? { reviewsStartDate } : {}),
      // Names are requested, then immediately redacted to "First L." by
      // redactRow() before the snapshot is written. See its comment.
      personalData: true,
    },
    timeoutMs: 45 * 60_000,
  });

  // Redact BEFORE parsing and before anything touches disk.
  const parsed = items.map((raw) =>
    GoogleReviewSchema.parse(redactRow(raw as Record<string, unknown>)),
  );

  const named = parsed.filter((r) => r.name && r.name !== "Anonymous").length;

  const { dataPath } = writeSnapshot({
    snapshotId,
    source: "google",
    items: parsed,
    meta: {
      // "incremental" also guarantees this snapshot can never trigger
      // tombstoning in normalize — only full coverage may do that.
      coverage,
      harvestedAt,
      adapterVersion: ADAPTER_VERSION,
      apifyRunId: runId,
      costUsd: usageTotalUsd,
      platformReportedCount: reviewsCount,
      platformReportedAverage: listing.totalScore ?? parsed[0]?.totalScore ?? null,
      notes:
        `Google reports ${reviewsCount ?? "?"} reviews on the listing; ` +
        `${parsed.length} were returned, ${named} with an attributable name. ` +
        (reviewsStartDate
          ? `Incremental run from ${reviewsStartDate.slice(0, 10)} ` +
            `(${INCREMENTAL_OVERLAP_DAYS}-day overlap). `
          : "") +
        `Reviewer names were redacted to "First L." at the harvest boundary — ` +
        `no surname, reviewer ID or avatar URL is stored in this snapshot.`,
    },
  });

  updateLedgerSnapshot(runId, dataPath);
  recordHarvest("google", {
    lastHarvestedAt: harvestedAt,
    lastSnapshotPath: dataPath,
    lastCoverage: coverage,
    itemCount: parsed.length,
    newestReviewDate:
      parsed
        .map((r) =>
          r.publishedAtDate ? new Date(r.publishedAtDate).toISOString() : null,
        )
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null,
  });

  console.log(`\n  harvested: ${parsed.length} of ${reviewsCount ?? "?"} reported`);
  console.log(`  snapshot:  ${dataPath}`);
}

function readYesSpend(args: string[]): number | undefined {
  const index = args.indexOf("--yes-spend");
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
