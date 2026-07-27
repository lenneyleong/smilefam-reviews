import assert from "node:assert/strict";
import { test } from "node:test";

import { computeAggregates, MIN_REVIEWS_FOR_AVERAGE } from "./aggregate";
import {
  applySuppressions,
  applyTombstones,
  canTombstone,
  makeContentKey,
  makeDedupeKey,
  mergeReviews,
} from "./dedupe";
import {
  contributesToAverage,
  displayablePhotos,
  type Review,
  ReviewSchema,
} from "./schema";
import { maskAuthorName, sha256 } from "./text";

const ISO = "2026-03-14T00:00:00.000Z";

function makeReview(over: Partial<Review> = {}): Review {
  const source = over.source ?? "stamped";
  const sourceId = over.sourceId ?? "1";
  const body = over.body ?? "Genuinely whiter after three weeks. Very happy.";
  const base: Review = {
    id: `${source}:${sourceId}`,
    dedupeKey: makeDedupeKey(source, sourceId),
    contentKey: makeContentKey({
      authorDisplay: "Mona R.",
      rating: 5,
      dateIso: ISO,
      body,
    }),
    source,
    sourceId,
    sourceUrl: null,
    sourceLabel: "SmileFam store",
    author: {
      display: "Mona R.",
      maskApplied: "platform-masked",
      location: "Singapore",
      countryIso: "SG",
    },
    rating: 5,
    recommended: null,
    title: null,
    body,
    bodyOriginal: null,
    bodyLanguage: "en",
    translated: false,
    translationSource: "none",
    date: ISO,
    datePrecision: "day",
    product: {
      name: "BLU Whitening Kit",
      sku: null,
      shopifyProductId: null,
      handle: "blu-whitening-kit",
      url: "https://getsmilefam.com/products/blu-teeth-whitening-kit",
    },
    photos: [],
    verifiedBuyer: true,
    verificationBasis: "platform-verified-buyer",
    merchantReply: null,
    helpfulCount: null,
    displayPolicy: {
      canRehostPhotos: true,
      canShowFullName: false,
      mustAttribute: false,
      attributionUrl: null,
    },
    provenance: {
      harvestedAt: ISO,
      snapshot: "data/raw/2026-03-14T0000Z/stamped.json.gz",
      rawIndex: 0,
      bodySha256: sha256(body),
      adapterVersion: "stamped@1",
      apifyRunId: null,
    },
    status: "active",
    firstSeenOn: "2026-03-14",
    lastSeenOn: "2026-03-14",
  };
  return ReviewSchema.parse({ ...base, ...over });
}

test("maskAuthorName strips surnames to an initial", () => {
  assert.equal(maskAuthorName("Wei Ling Tan").display, "Wei T.");
  assert.equal(maskAuthorName("Wei Ling Tan").maskApplied, "first-name-initial");
});

test("maskAuthorName leaves already-masked platform names alone", () => {
  assert.equal(maskAuthorName("Mona R.").display, "Mona R.");
  assert.equal(maskAuthorName("Mona R").display, "Mona R.");
  assert.equal(maskAuthorName("Mona R.").maskApplied, "platform-masked");
});

test("maskAuthorName degrades safely rather than throwing", () => {
  assert.equal(maskAuthorName("").display, "Anonymous");
  assert.equal(maskAuthorName(null).display, "Anonymous");
  assert.equal(maskAuthorName("Cher").display, "Cher");
});

test("a review body cannot diverge from its provenance hash", () => {
  const review = makeReview();
  assert.equal(review.provenance.bodySha256, sha256(review.body));
});

test("Facebook recommendations never contribute a star rating", () => {
  const fb = makeReview({
    source: "facebook",
    sourceId: "fb-1",
    sourceLabel: "Facebook",
    rating: null,
    recommended: true,
    verifiedBuyer: false,
    verificationBasis: "unverified",
  });
  assert.equal(contributesToAverage(fb), false);

  const aggregates = computeAggregates({
    reviews: [makeReview({ rating: 4 }), fb],
    reviewsSha256: sha256("x"),
    generatedAt: ISO,
    lastSyncedAt: ISO,
  });
  // Average is 4.0, not 4.5 — the recommendation is excluded, not mapped to 5.
  assert.equal(aggregates.weightedAverage.value, 4);
  assert.equal(aggregates.weightedAverage.n, 1);
  assert.equal(aggregates.totals.recommendationCount, 1);
  assert.equal(aggregates.totals.reviewCount, 2);
});

test("non-rehosted photos are never displayable", () => {
  const review = makeReview({
    photos: [
      {
        sha256: "a".repeat(64),
        src: null,
        remoteUrl: "https://lh3.googleusercontent.com/x.jpg",
        width: 800,
        height: 600,
        blurDataUrl: null,
        rehosted: false,
      },
    ],
  });
  assert.deepEqual(displayablePhotos(review), []);
});

test("product averages are suppressed below the sample floor", () => {
  const few = Array.from({ length: MIN_REVIEWS_FOR_AVERAGE - 1 }, (_, i) =>
    makeReview({ sourceId: `few-${i}`, dedupeKey: makeDedupeKey("stamped", `few-${i}`), id: `stamped:few-${i}` }),
  );
  const aggregates = computeAggregates({
    reviews: few,
    reviewsSha256: sha256("x"),
    generatedAt: ISO,
    lastSyncedAt: ISO,
  });
  const product = aggregates.byProduct[0]!;
  assert.equal(product.count, MIN_REVIEWS_FOR_AVERAGE - 1);
  assert.equal(product.showAverage, false);
  assert.equal(product.average, null);
});

test("platform-claimed counts stay separate from harvested counts", () => {
  const aggregates = computeAggregates({
    reviews: [makeReview({ source: "google", sourceId: "g1", id: "google:g1", dedupeKey: makeDedupeKey("google", "g1"), sourceLabel: "Google" })],
    reviewsSha256: sha256("x"),
    generatedAt: ISO,
    lastSyncedAt: ISO,
    platformReported: { google: { count: 1500, average: 4.9 } },
  });
  const google = aggregates.bySource.google!;
  assert.equal(google.harvestedCount, 1);
  assert.equal(google.platformReportedCount, 1500);
  assert.equal(google.discrepancy, 1499);
  // The headline total counts only what we actually hold.
  assert.equal(aggregates.totals.reviewCount, 1);
});

test("merge preserves firstSeenOn and already-rehosted photo work", () => {
  const rehosted = {
    sha256: "b".repeat(64),
    src: "/reviews/img/bbbbbbbbbbbb.webp",
    remoteUrl: "https://cdn1.stamped.io/uploads/photos/x.jpg",
    width: 1400,
    height: 1050,
    blurDataUrl: "data:image/webp;base64,AAAA",
    rehosted: true,
  };
  const existing = [makeReview({ firstSeenOn: "2023-08-02", photos: [rehosted] })];
  const incoming = [
    makeReview({
      firstSeenOn: "2026-07-27",
      lastSeenOn: "2026-07-27",
      photos: [{ ...rehosted, src: null, blurDataUrl: null, rehosted: false }],
    }),
  ];

  const merged = mergeReviews(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.firstSeenOn, "2023-08-02");
  assert.equal(merged[0]!.lastSeenOn, "2026-07-27");
  assert.equal(merged[0]!.photos[0]!.rehosted, true);
  assert.equal(merged[0]!.photos[0]!.src, "/reviews/img/bbbbbbbbbbbb.webp");
});

test("re-normalizing keeps image work when the placeholder hash differs", () => {
  // Regression: harvest adapters hash the FILENAME as a placeholder, while
  // images.ts rewrites sha256 to the hash of the real bytes. Merging on sha256
  // never matched, so every re-normalize silently discarded 284 downloaded and
  // optimized photos. Merge must key on remoteUrl.
  const remoteUrl = "https://cdn1.stamped.io/uploads/photos/real.jpg";

  const afterImages = makeReview({
    photos: [
      {
        sha256: "c".repeat(64), // hash of the real bytes
        src: "/reviews/img/cccccccccccc.webp",
        remoteUrl,
        width: 1400,
        height: 1050,
        blurDataUrl: "data:image/webp;base64,AAAA",
        rehosted: true,
      },
    ],
  });

  const freshHarvest = makeReview({
    photos: [
      {
        sha256: "d".repeat(64), // placeholder hash of the filename — differs
        src: null,
        remoteUrl,
        width: null,
        height: null,
        blurDataUrl: null,
        rehosted: false,
      },
    ],
  });

  const merged = mergeReviews([afterImages], [freshHarvest]);
  const photo = merged[0]!.photos[0]!;

  assert.equal(photo.rehosted, true);
  assert.equal(photo.src, "/reviews/img/cccccccccccc.webp");
  assert.equal(photo.width, 1400);
  assert.equal(displayablePhotos(merged[0]!).length, 1);
});

test("an incremental run may never tombstone", () => {
  const result = canTombstone({
    coverage: "incremental",
    returnedCount: 5,
    knownCount: 500,
  });
  assert.equal(result.ok, false);
});

test("a full run returning implausibly few reviews refuses to tombstone", () => {
  const blocked = canTombstone({
    coverage: "full",
    returnedCount: 12,
    knownCount: 500,
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason!, /blocked scrape/);

  const healthy = canTombstone({
    coverage: "full",
    returnedCount: 480,
    knownCount: 500,
  });
  assert.equal(healthy.ok, true);
});

test("a full harvest tombstones reviews it no longer returns", () => {
  const kept = makeReview({ sourceId: "keep", dedupeKey: makeDedupeKey("stamped", "keep"), id: "stamped:keep" });
  const gone = makeReview({ sourceId: "gone", dedupeKey: makeDedupeKey("stamped", "gone"), id: "stamped:gone" });
  const other = makeReview({
    source: "google",
    sourceId: "g1",
    dedupeKey: makeDedupeKey("google", "g1"),
    id: "google:g1",
    sourceLabel: "Google",
  });

  const result = applyTombstones({
    reviews: [kept, gone, other],
    source: "stamped",
    coverage: "full",
    incomingKeys: new Set([kept.dedupeKey]),
    returnedCount: 1,
    knownCount: 1, // plausible volume — 100% of what was previously known
    removedOn: "2026-07-28",
  });

  assert.equal(result.refusal, null);
  assert.equal(result.tombstoned, 1);
  const byId = new Map(result.reviews.map((r) => [r.id, r]));
  assert.equal(byId.get("stamped:gone")!.status, "removed");
  assert.equal(byId.get("stamped:gone")!.removedOn, "2026-07-28");
  assert.equal(byId.get("stamped:keep")!.status, "active");
  // Another source's records are never touched by this source's harvest.
  assert.equal(byId.get("google:g1")!.status, "active");

  // Removed records stay in the corpus but leave every public number.
  const aggregates = computeAggregates({
    reviews: result.reviews,
    reviewsSha256: sha256("x"),
    generatedAt: ISO,
    lastSyncedAt: ISO,
  });
  assert.equal(aggregates.totals.reviewCount, 2);
});

test("an incremental batch cannot tombstone via applyTombstones", () => {
  const known = makeReview({ sourceId: "old", dedupeKey: makeDedupeKey("stamped", "old"), id: "stamped:old" });
  const result = applyTombstones({
    reviews: [known],
    source: "stamped",
    coverage: "incremental",
    incomingKeys: new Set(), // returned nothing we know
    returnedCount: 0,
    knownCount: 1,
    removedOn: "2026-07-28",
  });
  assert.equal(result.tombstoned, 0);
  assert.equal(known.status, "active");
  assert.match(result.refusal!, /incremental/);
});

test("an implausibly small full run refuses to tombstone the corpus", () => {
  const reviews = Array.from({ length: 10 }, (_, i) =>
    makeReview({ sourceId: `r${i}`, dedupeKey: makeDedupeKey("stamped", `r${i}`), id: `stamped:r${i}` }),
  );
  const result = applyTombstones({
    reviews,
    source: "stamped",
    coverage: "full",
    incomingKeys: new Set([reviews[0]!.dedupeKey]),
    returnedCount: 1,
    knownCount: 10,
    removedOn: "2026-07-28",
  });
  assert.equal(result.tombstoned, 0);
  assert.match(result.refusal!, /blocked scrape/);
  assert.ok(result.reviews.every((r) => r.status === "active"));
});

test("suppressions remove a review even when the harvest still returns it", () => {
  const review = makeReview();
  const suppression = {
    dedupeKey: review.dedupeKey,
    reason: "PDPA removal request from reviewer",
    date: "2026-07-20",
  };

  // The review just came back from a fresh harvest (status active post-merge)…
  const result = applySuppressions([review], [suppression]);
  assert.equal(result.suppressed, 1);
  assert.equal(result.reviews[0]!.status, "removed");
  assert.equal(result.reviews[0]!.removedOn, "2026-07-20");
  assert.deepEqual(result.unmatched, []);

  // …and re-applying is idempotent (byte-identical re-runs).
  const again = applySuppressions(result.reviews, [suppression]);
  assert.equal(again.suppressed, 0);
  assert.deepEqual(again.reviews, result.reviews);

  // A suppression pointing at nothing is surfaced, not swallowed.
  const missing = applySuppressions([review], [
    { ...suppression, dedupeKey: "f".repeat(64) },
  ]);
  assert.equal(missing.unmatched.length, 1);
});

test("merge carries a machine-cached translation forward across re-harvests", () => {
  const original = "这个牙齿美白套装真的很好用，两周就见效了。";
  const prior = makeReview({
    body: "This teeth whitening kit really works — results in two weeks.",
    bodyOriginal: original,
    bodyLanguage: "zh-Hans",
    translated: true,
    translationSource: "machine-cached",
  });
  // A fresh harvest returns the untranslated original again.
  const fresh = makeReview({ body: original });

  const merged = mergeReviews([prior], [fresh]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.translationSource, "machine-cached");
  assert.equal(merged[0]!.body, prior.body);
  assert.equal(merged[0]!.bodyOriginal, original);
  assert.equal(merged[0]!.translated, true);
  assert.equal(merged[0]!.bodyLanguage, "zh-Hans");

  // But an EDITED upstream review must not keep the stale translation.
  const edited = makeReview({ body: `${original}更新了。` });
  const remerged = mergeReviews([prior], [edited]);
  assert.equal(remerged[0]!.translationSource, "none");
  assert.equal(remerged[0]!.body, edited.body);
});

test("the same review on two platforms stays two records", () => {
  const body = "Same words posted twice by the same person.";
  const google = makeReview({
    source: "google",
    sourceId: "g9",
    id: "google:g9",
    dedupeKey: makeDedupeKey("google", "g9"),
    sourceLabel: "Google",
    body,
    provenance: {
      harvestedAt: ISO,
      snapshot: "data/raw/x/google.json.gz",
      rawIndex: 0,
      bodySha256: sha256(body),
      adapterVersion: "google@1",
      apifyRunId: null,
    },
  });
  const shopee = makeReview({
    source: "shopee",
    sourceId: "s9",
    id: "shopee:s9",
    dedupeKey: makeDedupeKey("shopee", "s9"),
    sourceLabel: "Shopee SG",
    body,
    provenance: {
      harvestedAt: ISO,
      snapshot: "data/raw/x/shopee.json.gz",
      rawIndex: 0,
      bodySha256: sha256(body),
      adapterVersion: "shopee@1",
      apifyRunId: null,
    },
  });

  assert.notEqual(google.dedupeKey, shopee.dedupeKey);
  assert.equal(google.contentKey, shopee.contentKey);

  const aggregates = computeAggregates({
    reviews: [google, shopee],
    reviewsSha256: sha256("x"),
    generatedAt: ISO,
    lastSyncedAt: ISO,
  });
  assert.equal(aggregates.totals.reviewCount, 2);
  assert.equal(aggregates.totals.uniqueContentCount, 1);
});
