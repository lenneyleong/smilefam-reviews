import { z } from "zod";

/**
 * The normalized review record.
 *
 * Every field here exists to answer one of two questions:
 *   1. What do we display?  (author, rating, body, photos, product)
 *   2. How do we prove it's real?  (provenance)
 *
 * The second one is load-bearing. A sibling brand was publicly called out and
 * shut down over fabricated testimonials, so the standing rule across all of
 * Lenney's brands is that no review may ever be invented. `provenance` is that
 * rule expressed as a type: there is no way to construct a valid Review that
 * does not point at a byte range inside a committed raw snapshot, and
 * `scripts/verify.ts` re-hashes every one of them on every build.
 */

export const ReviewSource = z.enum(["stamped", "google", "shopee", "facebook"]);
export type ReviewSource = z.infer<typeof ReviewSource>;

/** Human-readable source labels. Used verbatim in UI and in schema.org `publisher`. */
export const SOURCE_LABELS: Record<ReviewSource, string> = {
  stamped: "SmileFam store",
  google: "Google",
  shopee: "Shopee SG",
  facebook: "Facebook",
};

/**
 * Where a review's listing lives. Google and Facebook do NOT expose per-review
 * permalinks, so those necessarily point at the listing rather than the review.
 * /methodology says so out loud rather than letting a reader click and wonder.
 */
export const SOURCE_LISTING_URLS: Record<ReviewSource, string | null> = {
  stamped: null,
  google:
    "https://www.google.com/maps/place/?q=place_id:ChIJKx3Kew8T2jEREq80IczvRfQ",
  shopee: "https://shopee.sg/smilefam",
  facebook: "https://www.facebook.com/getsmilefam/reviews",
};

export const ReviewPhotoSchema = z.object({
  /** sha256 of the ORIGINAL downloaded bytes. Also the dedupe key across reviews. */
  sha256: z.string().length(64),
  /** Local path, e.g. "/reviews/img/4c9a12b8ef01.webp". Null when not rehosted. */
  src: z.string().nullable(),
  /** Original CDN URL. Kept for attribution only — these expire. */
  remoteUrl: z.url().nullable(),
  /**
   * Null until scripts/images.ts has downloaded and measured the real bytes.
   * Null rather than 0 on purpose: a component that needs intrinsic dimensions
   * to avoid layout shift should fail loudly on null, not silently lay out a
   * zero-sized box.
   */
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  /** Tiny base64 blur placeholder, inlined in JSON rather than written to disk. */
  blurDataUrl: z.string().nullable(),
  /**
   * False means we are NOT permitted to serve this image.
   * `components/ReviewPhoto.tsx` refuses to render anything where this is false,
   * so the rehost policy cannot be violated by accident downstream.
   */
  rehosted: z.boolean(),
});
export type ReviewPhoto = z.infer<typeof ReviewPhotoSchema>;

export const ReviewAuthorSchema = z.object({
  /** Already masked at the adapter boundary. Never holds a full surname. */
  display: z.string().min(1),
  maskApplied: z.enum(["none", "first-name-initial", "platform-masked"]),
  location: z.string().nullable(),
  countryIso: z.string().length(2).nullable(),
});

export const ReviewProductSchema = z.object({
  name: z.string(),
  sku: z.string().nullable(),
  shopifyProductId: z.string().nullable(),
  /** Our own route slug, e.g. "blu-whitening-kit". Null if unmapped. */
  handle: z.string().nullable(),
  /** The getsmilefam.com PDP. This is where the contextual backlink points. */
  url: z.url().nullable(),
});

/**
 * How a review earns its verification badge.
 *
 * The UI distinguishes these honestly: Stamped/Shopee show "Verified purchase",
 * Google/Facebook show "Public review — purchase not verified". Badging
 * everything "verified" is the tell of a fake review site.
 */
export const VerificationBasis = z.enum([
  "platform-verified-buyer",
  "platform-order-linked",
  "unverified",
]);

export const ProvenanceSchema = z.object({
  harvestedAt: z.iso.datetime(),
  /** Path to the committed snapshot, e.g. "data/raw/2026-07-27T0930Z/google.json.gz". */
  snapshot: z.string().min(1),
  /** Index into that snapshot's array. */
  rawIndex: z.int().nonnegative(),
  /** sha256 of the raw source text, before any normalization. The audit anchor. */
  bodySha256: z.string().length(64),
  /** e.g. "google@1" — lets us re-derive when an adapter's mapping changes. */
  adapterVersion: z.string().min(1),
  apifyRunId: z.string().nullable(),
});

export const ReviewSchema = z.object({
  /** `${source}:${sourceId}` — stable and human-readable. */
  id: z.string().min(3),
  /** sha256(`${source}|${sourceId}`). Authoritative identity, per source. */
  dedupeKey: z.string().length(64),
  /**
   * sha256 of normalized (author|rating|date|body-prefix). NOT used to merge —
   * a Google review and a Facebook recommendation from the same person are two
   * independently verifiable artifacts and collapsing them destroys the audit
   * trail. Collisions are reported as `uniqueContentCount` so the headline
   * count can be defended either way.
   */
  contentKey: z.string().length(64),

  source: ReviewSource,
  sourceId: z.string().min(1),
  sourceUrl: z.url().nullable(),
  sourceLabel: z.string().min(1),

  author: ReviewAuthorSchema,

  /** Null for Facebook, which exposes recommend/not-recommend and no stars. */
  rating: z.number().min(1).max(5).nullable(),
  /** Facebook only. Never mapped to a star rating — that would be fabrication. */
  recommended: z.boolean().nullable(),

  title: z.string().nullable(),
  /** Display text. English. May be a translation of `bodyOriginal`. */
  body: z.string().min(1),
  /** Source-language text when translated. NEVER dropped. */
  bodyOriginal: z.string().nullable(),
  bodyLanguage: z.string().min(2),
  translated: z.boolean(),
  translationSource: z.enum(["none", "platform", "machine-cached"]),

  date: z.iso.datetime(),
  datePrecision: z.enum(["day", "second"]),

  product: ReviewProductSchema.nullable(),
  photos: z.array(ReviewPhotoSchema),

  verifiedBuyer: z.boolean(),
  verificationBasis: VerificationBasis,
  merchantReply: z
    .object({ body: z.string().min(1), date: z.iso.datetime().nullable() })
    .nullable(),
  helpfulCount: z.int().nonnegative().nullable(),

  displayPolicy: z.object({
    /** Only first-party Stamped photos are true. See scripts/images.ts. */
    canRehostPhotos: z.boolean(),
    /** Always false today. PDPA — we never publish surnames. */
    canShowFullName: z.boolean(),
    mustAttribute: z.boolean(),
    attributionUrl: z.url().nullable(),
  }),

  provenance: ProvenanceSchema,

  status: z.enum(["active", "removed"]),
  /**
   * "YYYY-MM-DD" — set when status flips to "removed" (tombstoned by a full
   * harvest, or suppressed via data/suppressions.json). Absent while active.
   * Derived from the harvest/suppression date, not wall-clock time, so
   * re-running normalize stays deterministic.
   */
  removedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** "YYYY-MM-DD" — day precision keeps unchanged re-runs to a zero-line diff. */
  firstSeenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastSeenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type Review = z.infer<typeof ReviewSchema>;

export const ReviewsFileSchema = z.array(ReviewSchema);

/**
 * A review is only renderable with photos if the photo was actually rehosted.
 * Third-party platform images stay on their own CDNs and are never served
 * from our origin (Maps/Shopee/Meta ToS, plus PDPA on reviewer avatars).
 */
export function displayablePhotos(review: Review): ReviewPhoto[] {
  return review.photos.filter(
    (p) => p.rehosted && p.src !== null && p.width !== null && p.height !== null,
  );
}

/**
 * Facebook recommendations carry no star rating, so they are excluded from any
 * weighted average. Mapping "recommended" to 5 stars would invent a rating the
 * customer never gave.
 */
export function contributesToAverage(review: Review): boolean {
  return review.status === "active" && review.rating !== null;
}
