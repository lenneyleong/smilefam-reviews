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
import { recordHarvest } from "../lib/harvest-state";
import { makeSnapshotId, writeSnapshot } from "../lib/snapshot";

/**
 * Facebook page recommendations via apify/facebook-reviews-scraper.
 *
 * Important limitation, verified against the actor's output schema: Facebook
 * recommendations carry **no star rating and no review photos**. Only
 * `isRecommended`. So this source:
 *   - contributes recommendation counts, never a star average
 *   - contributes zero photos
 *
 * Mapping "recommended" onto 5 stars would invent a rating the customer never
 * gave, which is exactly the kind of thing the no-fabricated-reviews rule
 * exists to prevent. The schema enforces it: `rating` is null here.
 */

const ADAPTER_VERSION = "facebook@1";
const PAGE_URL = "https://www.facebook.com/getsmilefam";

export const FacebookReviewSchema = z.object({
  // Field naming varies across actor builds; accept the common aliases rather
  // than failing the whole harvest over one renamed key.
  id: z.union([z.string(), z.number()]).nullish(),
  reviewId: z.union([z.string(), z.number()]).nullish(),
  url: z.string().nullish(),
  facebookUrl: z.string().nullish(),
  user: z
    .object({ name: z.string().nullish(), id: z.string().nullish() })
    .nullish(),
  userName: z.string().nullish(),
  text: z.string().nullish(),
  isRecommended: z.boolean().nullish(),
  date: z.string().nullish(),
  time: z.string().nullish(),
  likesCount: z.number().nullish(),
  commentsCount: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
});

export type FacebookReview = z.infer<typeof FacebookReviewSchema>;

/**
 * Map a Facebook recommendation onto the normalized shape.
 *
 * `rating` stays null. Facebook has no stars, and converting "recommended" into
 * 5 stars would put a number in a customer's mouth that they never said — the
 * exact class of fabrication the project's rules forbid. These records show up
 * as recommendations in the aggregates and are excluded from the average.
 */
export function toReview(
  raw: FacebookReview,
  context: { snapshot: string; rawIndex: number; harvestedAt: string },
): Review | null {
  const body = (raw.text ?? "").trim();
  if (!body) return null;

  const sourceId = String(raw.reviewId ?? raw.id ?? "");
  if (!sourceId) return null;

  const rawDate = raw.date ?? raw.time ?? null;
  const parsed = rawDate ? new Date(rawDate) : null;
  const dateIso =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : context.harvestedAt;

  const { display, maskApplied } = maskAuthorName(
    raw.user?.name ?? raw.userName ?? null,
  );

  return ReviewSchema.parse({
    id: `facebook:${sourceId}`,
    dedupeKey: makeDedupeKey("facebook", sourceId),
    contentKey: makeContentKey({
      authorDisplay: display,
      rating: null,
      dateIso,
      body,
    }),
    source: "facebook",
    sourceId,
    sourceUrl: raw.url ?? raw.facebookUrl ?? SOURCE_LISTING_URLS.facebook,
    sourceLabel: SOURCE_LABELS.facebook,
    author: { display, maskApplied, location: null, countryIso: null },
    rating: null,
    recommended: raw.isRecommended ?? null,
    title: null,
    body,
    bodyOriginal: null,
    bodyLanguage: "en",
    translated: false,
    translationSource: "none",
    date: dateIso,
    datePrecision: "day",
    product: null,
    photos: [],
    verifiedBuyer: false,
    verificationBasis: "unverified",
    merchantReply: null,
    helpfulCount: raw.likesCount ?? null,
    displayPolicy: {
      canRehostPhotos: false,
      canShowFullName: false,
      mustAttribute: true,
      attributionUrl: SOURCE_LISTING_URLS.facebook,
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

/**
 * Privacy redaction at the harvest boundary, mirroring the Google adapter.
 *
 * Snapshots are committed to git forever, so the full name and the stable
 * Facebook user id must never reach disk. An earlier run committed both; that
 * snapshot was rewritten in place and history recreated on 2026-07-28 — this
 * function is what prevents a recurrence.
 */
export function redactRow(raw: Record<string, unknown>): Record<string, unknown> {
  const user = raw.user as { name?: string | null } | null | undefined;
  const { display } = maskAuthorName(
    (user?.name ?? (raw.userName as string | null)) || null,
  );

  const cleaned: Record<string, unknown> = { ...raw };
  if (cleaned.user) cleaned.user = { name: display };
  if (cleaned.userName) cleaned.userName = display;
  for (const key of ["profileUrl", "profilePic", "profilePicture"]) {
    delete cleaned[key];
  }

  // Facebook review ids are base64 blobs that DECODE to
  // "S:_I<numericUserId>:<postId>..." — the reviewer's Facebook account is one
  // atob() away. Replace with a one-way hash: stable across harvests (same
  // original id → same hash → dedupe still works) but not reversible.
  for (const key of ["id", "reviewId"] as const) {
    const value = cleaned[key];
    if (typeof value === "string" || typeof value === "number") {
      cleaned[key] = sha256(String(value)).slice(0, 24);
    }
  }
  return cleaned;
}

function readFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resultsLimit = readFlag(args, "--limit") ?? 200;
  const yesSpend = readFlag(args, "--yes-spend");

  const harvestedAt = new Date().toISOString();
  const snapshotId = makeSnapshotId(new Date(harvestedAt));

  const { items, runId, usageTotalUsd } = await runActor<unknown, FacebookReview>({
    actorKey: "facebook",
    label: "facebook",
    expectedResults: resultsLimit,
    yesSpendUsd: yesSpend,
    input: {
      startUrls: [{ url: PAGE_URL }],
      resultsLimit,
    },
    timeoutMs: 20 * 60_000,
  });

  const parsed = items.map((raw) =>
    FacebookReviewSchema.parse(redactRow(raw as Record<string, unknown>)),
  );
  const recommended = parsed.filter((r) => r.isRecommended === true).length;
  const withText = parsed.filter((r) => (r.text ?? "").trim().length > 0).length;

  // Only a genuinely exhaustive pull may be called full; this actor has no
  // date filter, so anything capped by resultsLimit is incremental and can
  // never trigger tombstoning.
  const coverage = parsed.length < resultsLimit ? ("full" as const) : ("incremental" as const);

  const { dataPath } = writeSnapshot({
    snapshotId,
    source: "facebook",
    items: parsed,
    meta: {
      coverage,
      harvestedAt,
      adapterVersion: ADAPTER_VERSION,
      apifyRunId: runId,
      costUsd: usageTotalUsd,
      platformReportedCount: null,
      platformReportedAverage: null,
      notes:
        `${recommended} of ${parsed.length} are recommendations; ${withText} carry text. ` +
        `Facebook exposes no star rating and no review photos, so this source is ` +
        `excluded from the weighted average by design.`,
    },
  });

  // Link the spend to the evidence it bought, and remember where this source
  // now stands for the refresh orchestrator's gating.
  updateLedgerSnapshot(runId, dataPath);
  recordHarvest("facebook", {
    lastHarvestedAt: harvestedAt,
    lastSnapshotPath: dataPath,
    lastCoverage: coverage,
    itemCount: parsed.length,
    newestReviewDate:
      parsed
        .map((r) => {
          const raw = r.date ?? r.time ?? null;
          const d = raw ? new Date(raw) : null;
          return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
        })
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null,
  });

  console.log(`\n  harvested:       ${parsed.length}`);
  console.log(`  recommended:     ${recommended}`);
  console.log(`  with text:       ${withText}`);
  console.log(`  snapshot:        ${dataPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
