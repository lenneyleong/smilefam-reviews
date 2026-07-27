import "./env";

import path from "node:path";
import { franc } from "franc-min";

import {
  applySuppressions,
  applyTombstones,
  mergeReviews,
  sortDeterministically,
  SuppressionsFileSchema,
} from "../lib/reviews/dedupe";
import type { Review, ReviewSource } from "../lib/reviews/schema";
import { ReviewsFileSchema } from "../lib/reviews/schema";
import {
  MIN_CHARS_FOR_LANGUAGE_DETECTION,
  toBcp47,
  toDayString,
} from "../lib/reviews/text";
import {
  latestSnapshotFor,
  readJsonIfExists,
  readSnapshot,
  readSnapshotMeta,
  type SnapshotCoverage,
  writeJsonAtomic,
} from "./lib/snapshot";
import { toReview as facebookToReview } from "./harvest/facebook";
import { toReview as googleToReview } from "./harvest/google";
import { loadProductMap } from "./harvest/shopify-products";
import { hasPhotos, STAMPED_PHOTO_ONLY } from "./harvest/stamped.config";
import { toReview as stampedToReview } from "./harvest/stamped";

/**
 * Turn the newest raw snapshot of each source into data/reviews.json.
 *
 * Idempotent by construction: re-running with unchanged snapshots produces a
 * byte-identical file, so a non-empty git diff always means something actually
 * changed upstream. That silence is the point — it's how a surprise gets
 * noticed instead of blending into churn.
 *
 * Removal paths, both of which keep the record in the corpus (status
 * "removed") so provenance stays checkable:
 *
 *   1. TOMBSTONING — a FULL-coverage harvest that no longer returns a known
 *      review marks it removed, guarded by canTombstone() so a blocked scrape
 *      can never wipe the corpus. Incremental runs may never tombstone.
 *   2. SUPPRESSIONS — data/suppressions.json entries are marked removed
 *      unconditionally, on every run. This is the PDPA-removal path that
 *      /methodology promises, and it must win even if the platform still
 *      serves the review.
 */

const REVIEWS_PATH = path.join("data", "reviews.json");
const SUPPRESSIONS_PATH = path.join("data", "suppressions.json");

/** What one source contributed this run, plus the snapshot facts that decide
 * whether it is allowed to tombstone. */
interface SourceBatch {
  source: ReviewSource;
  reviews: Review[];
  coverage: SnapshotCoverage;
  harvestedAt: string;
}

/**
 * Detect language from the body text. Short strings are assumed English —
 * franc classifies "Very good!" as essentially anything, and a wrong `lang`
 * attribute is worse than a conservative default.
 */
function detectLanguage(body: string): string {
  if (body.length < MIN_CHARS_FOR_LANGUAGE_DETECTION) return "en";
  const iso3 = franc(body, { only: ["eng", "cmn", "zsm", "tam"] });
  return iso3 === "und" ? "en" : toBcp47(iso3);
}

function normalizeStamped(): SourceBatch | null {
  const snapshot = latestSnapshotFor("stamped");
  if (!snapshot) {
    console.log("  stamped:  no snapshot — skipping");
    return null;
  }

  const meta = readSnapshotMeta(snapshot);
  const rows = readSnapshot<Record<string, unknown>>(snapshot);
  const productMap = loadProductMap();

  const reviews: Review[] = [];
  rows.forEach((raw, rawIndex) => {
    if (STAMPED_PHOTO_ONLY && !hasPhotos(raw)) return;

    // rawIndex is the index into the FULL snapshot, so provenance stays valid
    // even though we only publish a subset.
    reviews.push(
      stampedToReview(raw as never, {
        snapshot,
        rawIndex,
        harvestedAt: meta.harvestedAt,
        productMap,
      }),
    );
  });

  console.log(
    `  stamped:  ${reviews.length} of ${rows.length} rows ` +
      `(photo-only=${STAMPED_PHOTO_ONLY})`,
  );
  return {
    source: "stamped",
    reviews,
    coverage: meta.coverage,
    harvestedAt: meta.harvestedAt,
  };
}

/**
 * Shared shape for the paid sources. Each returns null for rows with no text —
 * a bare star rating is real but has nothing to display, and the gap between
 * what a platform reports and what we can show is recorded as `discrepancy` in
 * aggregates.json rather than hidden.
 */
function normalizeVia(
  source: "google" | "facebook",
  adapt: (
    raw: never,
    ctx: { snapshot: string; rawIndex: number; harvestedAt: string },
  ) => Review | null,
): SourceBatch | null {
  const snapshot = latestSnapshotFor(source);
  if (!snapshot) {
    console.log(`  ${source}: no snapshot — skipping`);
    return null;
  }

  const meta = readSnapshotMeta(snapshot);
  const rows = readSnapshot<never>(snapshot);

  const reviews: Review[] = [];
  let skipped = 0;
  rows.forEach((raw, rawIndex) => {
    const review = adapt(raw, {
      snapshot,
      rawIndex,
      harvestedAt: meta.harvestedAt,
    });
    if (review) reviews.push(review);
    else skipped += 1;
  });

  console.log(
    `  ${source.padEnd(9)} ${reviews.length} of ${rows.length} rows` +
      (skipped ? `  (${skipped} skipped — no review text)` : ""),
  );
  return {
    source,
    reviews,
    coverage: meta.coverage,
    harvestedAt: meta.harvestedAt,
  };
}

function applyLanguageDetection(reviews: Review[]): Review[] {
  return reviews.map((review) => {
    // Sources that translate for us (Google) set this themselves — don't clobber.
    if (review.translationSource !== "none") return review;
    return { ...review, bodyLanguage: detectLanguage(review.body) };
  });
}

export async function run(): Promise<void> {
  console.log("Normalizing snapshots → data/reviews.json");

  const batches = [
    normalizeStamped(),
    normalizeVia("google", googleToReview),
    normalizeVia("facebook", facebookToReview),
    // Shopee lands once the 5 product URLs are in shopee.config.ts.
  ].filter((b): b is SourceBatch => b !== null);

  const incoming = applyLanguageDetection(batches.flatMap((b) => b.reviews));

  const existing =
    ReviewsFileSchema.safeParse(readJsonIfExists<unknown>(REVIEWS_PATH) ?? [])
      .data ?? [];

  let merged = mergeReviews(existing, incoming);

  // Tombstoning: only a full-coverage batch may mark known reviews removed,
  // and only when it returned plausible volume. Note the returnedCount for
  // stamped is the PUBLISHED subset (post photo-filter), which is also what
  // knownCount was built from — comparing filtered vs unfiltered counts would
  // make the coverage ratio meaningless.
  for (const batch of batches) {
    const knownCount = existing.filter(
      (r) => r.source === batch.source && r.status === "active",
    ).length;
    const result = applyTombstones({
      reviews: merged,
      source: batch.source,
      coverage: batch.coverage,
      incomingKeys: new Set(batch.reviews.map((r) => r.dedupeKey)),
      returnedCount: batch.reviews.length,
      knownCount,
      removedOn: toDayString(batch.harvestedAt),
    });
    merged = result.reviews;
    if (result.tombstoned > 0) {
      console.log(
        `  ${batch.source}: tombstoned ${result.tombstoned} review(s) no longer returned by a full harvest`,
      );
    } else if (result.refusal && batch.coverage === "full") {
      console.warn(`  ${batch.source}: tombstoning refused — ${result.refusal}`);
    }
  }

  // Suppressions LAST, so a re-harvest can never revive a suppressed review.
  const suppressions = SuppressionsFileSchema.parse(
    readJsonIfExists<unknown>(SUPPRESSIONS_PATH) ?? [],
  );
  const suppression = applySuppressions(merged, suppressions);
  merged = suppression.reviews;
  if (suppression.suppressed > 0) {
    console.log(`  suppressed ${suppression.suppressed} review(s) via ${SUPPRESSIONS_PATH}`);
  }
  for (const miss of suppression.unmatched) {
    console.warn(
      `  ⚠ suppression ${miss.dedupeKey.slice(0, 12)}… matches no review in the corpus (${miss.reason})`,
    );
  }

  writeJsonAtomic(REVIEWS_PATH, sortDeterministically(merged));

  const active = merged.filter((r) => r.status === "active");
  const nonEnglish = active.filter((r) => r.bodyLanguage !== "en");
  const withPhotos = active.filter((r) => r.photos.length > 0);
  const unmappedProducts = active.filter(
    (r) => r.product !== null && r.product.handle === null,
  );

  console.log(`\n  total reviews:      ${merged.length}`);
  if (merged.length !== active.length) {
    console.log(`  removed (kept for audit): ${merged.length - active.length}`);
  }
  console.log(`  carrying photos:    ${withPhotos.length}`);
  console.log(
    `  photo files:        ${active.reduce((n, r) => n + r.photos.length, 0)}`,
  );
  console.log(`  non-English bodies: ${nonEnglish.length}`);
  console.log(`  unmapped products:  ${unmappedProducts.length}`);

  if (unmappedProducts.length > 0) {
    const names = new Set(unmappedProducts.map((r) => r.product?.name));
    console.log(
      `    ⚠ these get no store backlink: ${[...names].join(", ")}`,
    );
  }
  console.log(`  → ${REVIEWS_PATH}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
