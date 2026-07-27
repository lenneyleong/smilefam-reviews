import "../env";

import { z } from "zod";

import {
  makeContentKey,
  makeDedupeKey,
} from "../../lib/reviews/dedupe";
import {
  type Review,
  ReviewSchema,
  SOURCE_LABELS,
} from "../../lib/reviews/schema";
import { maskAuthorName, sha256, toDayString } from "../../lib/reviews/text";
import { recordHarvest } from "../lib/harvest-state";
import { getJson, sleep } from "../lib/http";
import { makeSnapshotId, writeSnapshot } from "../lib/snapshot";
import { loadProductMap } from "./shopify-products";
import { hasPhotos, STAMPED_PHOTO_ONLY } from "./stamped.config";

/**
 * Stamped.io — SmileFam's own review app, already installed on the Shopify
 * store. First-party, free, unauthenticated, and the only source whose photos
 * we are entitled to rehost (customers uploaded them to the brand's own app).
 *
 * Verified live: 417 published / 489 total, 100% five-star, 0 merchant replies,
 * 128 verified-buyer, Aug 2023 → Jul 2026, 136 reviews carrying 284 photos.
 *
 * Two things this adapter deliberately does NOT do:
 *   - It does not invent the 72 unpublished reviews (489 - 417). Stamped's
 *     public widget only exposes published ones; /methodology reports the gap
 *     rather than the site pretending it doesn't exist.
 *   - It does not fabricate a rating for anything. Everything here is a real 5.
 */

const ADAPTER_VERSION = "stamped@1";
const STORE_URL = "609329.myshopify.com";
const PHOTO_CDN = "https://cdn1.stamped.io/uploads/photos/";
const PAGE_SIZE = 100;

// The photo-only publish policy lives in ./stamped.config.ts (STAMPED_PHOTO_ONLY
// + the shared hasPhotos predicate), imported above — one definition for both
// this harvester and scripts/normalize.ts.

/**
 * Undocumented endpoint: optional fields are sometimes `null` and sometimes
 * simply absent, so every nullable field is `.nullish()`. Being strict about
 * presence here would fail the whole harvest over a missing photo key.
 */
const StampedReviewSchema = z.object({
  id: z.union([z.number(), z.string()]),
  author: z.string().nullish(),
  reviewTitle: z.string().nullish(),
  reviewMessage: z.string(),
  reviewRating: z.number(),
  /** "MM/DD/YYYY" — we prefer dateCreated, which is a real ISO timestamp. */
  reviewDate: z.string().nullish(),
  dateCreated: z.string(),
  /** Comma-separated bare filenames. Absent or null when the review has none. */
  reviewUserPhotos: z.string().nullish(),
  /** 2 = verified buyer, 0 = not. */
  reviewVerifiedType: z.number(),
  reviewReply: z.string().nullish(),
  /** Shopify product ID — the bridge to data/products.json. */
  productId: z.union([z.number(), z.string()]).nullish(),
  productName: z.string().nullish(),
  productSKU: z.string().nullish(),
  location: z.string().nullish(),
  countryIso: z.string().nullish(),
});

type StampedReview = z.infer<typeof StampedReviewSchema>;

interface StampedEnvelope {
  data: unknown[];
  total: number;
  totalAll: number;
  rating: number;
  ratingAll: number;
}

async function fetchAllPages(): Promise<{
  rows: StampedReview[];
  total: number;
  totalAll: number;
  rating: number;
}> {
  const rows: StampedReview[] = [];
  let total = 0;
  let totalAll = 0;
  let rating = 0;

  for (let page = 1; page <= 50; page += 1) {
    const url =
      `https://stamped.io/api/widget/reviews?storeUrl=${STORE_URL}` +
      `&take=${PAGE_SIZE}&page=${page}`;
    const envelope = await getJson<StampedEnvelope>(url);

    total = envelope.total;
    totalAll = envelope.totalAll;
    rating = envelope.rating;

    const parsed = envelope.data.map((raw) => StampedReviewSchema.parse(raw));
    rows.push(...parsed);

    if (parsed.length < PAGE_SIZE || rows.length >= total) break;
    await sleep(400); // undocumented endpoint that owes us nothing — go gently
  }

  return { rows, total, totalAll, rating };
}

export function toReview(
  raw: StampedReview,
  context: {
    snapshot: string;
    rawIndex: number;
    harvestedAt: string;
    productMap: ReturnType<typeof loadProductMap>;
  },
): Review {
  const sourceId = String(raw.id);
  const body = raw.reviewMessage.trim();
  const dateIso = new Date(raw.dateCreated).toISOString();
  const { display, maskApplied } = maskAuthorName(raw.author);

  const product = raw.productId
    ? (context.productMap.get(String(raw.productId)) ?? null)
    : null;

  const filenames = (raw.reviewUserPhotos ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return ReviewSchema.parse({
    id: `stamped:${sourceId}`,
    dedupeKey: makeDedupeKey("stamped", sourceId),
    contentKey: makeContentKey({
      authorDisplay: display,
      rating: raw.reviewRating,
      dateIso,
      body,
    }),
    source: "stamped",
    sourceId,
    // Stamped exposes no public per-review permalink; the review lives on the
    // store's own product page, which we already link to via `product.url`.
    sourceUrl: null,
    sourceLabel: SOURCE_LABELS.stamped,
    author: {
      display,
      maskApplied,
      location: raw.location?.trim() || null,
      countryIso: raw.countryIso?.trim()?.toUpperCase()?.slice(0, 2) || null,
    },
    rating: raw.reviewRating,
    recommended: null,
    title: raw.reviewTitle?.trim() || null,
    body,
    bodyOriginal: null,
    // Language is detected in scripts/normalize.ts, which has franc available.
    bodyLanguage: "en",
    translated: false,
    translationSource: "none",
    date: dateIso,
    datePrecision: "second",
    product: raw.productName
      ? {
          name: raw.productName,
          sku: raw.productSKU?.trim() || null,
          shopifyProductId: raw.productId ? String(raw.productId) : null,
          handle: product?.handle ?? null,
          url: product?.url ?? null,
        }
      : null,
    // Photos are recorded here but NOT yet rehosted — scripts/images.ts
    // downloads, strips EXIF and optimizes them, then flips `rehosted`.
    photos: filenames.map((filename) => ({
      // Placeholder until the real bytes are hashed by scripts/images.ts.
      sha256: sha256(filename),
      src: null,
      remoteUrl: `${PHOTO_CDN}${filename}`,
      width: null,
      height: null,
      blurDataUrl: null,
      rehosted: false,
    })),
    verifiedBuyer: raw.reviewVerifiedType === 2,
    verificationBasis:
      raw.reviewVerifiedType === 2 ? "platform-verified-buyer" : "unverified",
    merchantReply: raw.reviewReply?.trim()
      ? { body: raw.reviewReply.trim(), date: null }
      : null,
    helpfulCount: null,
    displayPolicy: {
      // The one source where this is true. See scripts/images.ts.
      canRehostPhotos: true,
      canShowFullName: false,
      mustAttribute: false,
      attributionUrl: null,
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

export async function run(): Promise<void> {
  const harvestedAt = new Date().toISOString();
  const snapshotId = makeSnapshotId(new Date(harvestedAt));

  console.log("Fetching Stamped reviews…");
  const { rows, total, totalAll, rating } = await fetchAllPages();

  const photoRows = rows.filter((r) => hasPhotos(r));
  const selected = STAMPED_PHOTO_ONLY ? photoRows : rows;

  // The snapshot holds EVERY row we were served, not just the ones we display.
  // Filtering is a display decision; the evidence record should be complete so
  // the photo-only cut can be reversed later without re-fetching. For the same
  // reason the notes no longer state the STAMPED_PHOTO_ONLY value — display
  // policy is recorded in data/harvest-state.json, not in the evidence.
  const { dataPath } = writeSnapshot({
    snapshotId,
    source: "stamped",
    items: rows,
    meta: {
      coverage: "full",
      harvestedAt,
      adapterVersion: ADAPTER_VERSION,
      apifyRunId: null,
      costUsd: 0,
      platformReportedCount: total,
      platformReportedAverage: rating,
      notes:
        `Stamped reports ${total} published of ${totalAll} total ` +
        `(${totalAll - total} collected but not displayed by the store). ` +
        `${photoRows.length} of ${rows.length} carry customer photos.`,
    },
  });

  const newestReviewDate = rows
    .map((r) => new Date(r.dateCreated).toISOString())
    .sort()
    .at(-1) ?? null;

  recordHarvest("stamped", {
    lastHarvestedAt: harvestedAt,
    lastSnapshotPath: dataPath,
    lastCoverage: "full",
    itemCount: rows.length,
    newestReviewDate,
    stampedPhotoOnly: STAMPED_PHOTO_ONLY,
  });

  const photoCount = selected.reduce(
    (n, r) => n + (r.reviewUserPhotos ?? "").split(",").filter(Boolean).length,
    0,
  );

  console.log(`  fetched:            ${rows.length}`);
  console.log(`  platform published: ${total}`);
  console.log(`  platform total:     ${totalAll}  (${totalAll - total} withheld by store)`);
  console.log(`  with photos:        ${photoRows.length}`);
  console.log(`  selected:           ${selected.length}  (STAMPED_PHOTO_ONLY=${STAMPED_PHOTO_ONLY})`);
  console.log(`  photos to fetch:    ${photoCount}`);
  console.log(`  snapshot:           ${dataPath}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
