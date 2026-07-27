import Image from "next/image";

import { formatDate } from "@/lib/data";
import { toSgDay } from "@/lib/schema";
import {
  displayablePhotos,
  type Review,
  type ReviewPhoto as ReviewPhotoType,
} from "@/lib/reviews/schema";

/**
 * A single review.
 *
 * Two details carry most of the trust weight:
 *
 *   1. The verification badge tells the truth. Stamped and Shopee reviews are
 *      order-linked and say "Verified purchase"; Google and Facebook reviews
 *      are public and say so. Sites that badge everything "verified" are
 *      transparently lying, and distinguishing is what an actual review
 *      platform does.
 *
 *   2. The provenance fingerprint. Every card carries the first 8 characters of
 *      its body hash, which `npm run verify` checks against the committed raw
 *      snapshot on every build. It is a small thing, but it is the visible end
 *      of the chain that makes "we didn't write these" checkable rather than
 *      merely asserted.
 */

export function ReviewCard({
  review,
  headingLevel = "h3",
}: {
  review: Review;
  headingLevel?: "h3" | "h4";
}) {
  const Heading = headingLevel;
  const photos = displayablePhotos(review);
  // dedupeKey is sha256(source|sourceId) — the only per-review string with no
  // shared prefixes. Google sourceIds share their first characters, so slicing
  // those collapsed most of the corpus onto a handful of anchor ids.
  const anchor = `r-${review.dedupeKey.slice(0, 12)}`;

  return (
    <article
      id={anchor}
      className="scroll-mt-24 border-b border-mist py-8 last:border-b-0"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading className="font-medium text-navy">
          {review.author.display}
        </Heading>
        <Rating rating={review.rating} recommended={review.recommended} />
        <time
          dateTime={toSgDay(review.date)}
          className="text-sm font-light text-navy-soft"
        >
          {formatDate(review.date)}
        </time>
      </header>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <SourceBadge review={review} />
        <VerificationBadge review={review} />
        {review.product?.name && (
          <span className="text-navy-soft">{review.product.name}</span>
        )}
      </div>

      <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
        {review.body}
      </p>

      {review.translated && review.bodyOriginal && (
        <details className="mt-3 text-sm text-navy-soft">
          <summary className="cursor-pointer font-medium">
            Translated by {review.translationSource === "platform" ? "Google" : "machine"} — show {review.author.display}&rsquo;s original
          </summary>
          <p
            lang={review.bodyLanguage === "en" ? undefined : review.bodyLanguage}
            className="prose-measure mt-2 font-light"
          >
            {review.bodyOriginal}
          </p>
        </details>
      )}

      {photos.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-3">
          {photos.map((photo) => (
            <li key={photo.sha256}>
              <ReviewPhoto
                photo={photo}
                author={review.author.display}
                productName={review.product?.name ?? null}
              />
            </li>
          ))}
        </ul>
      )}

      {review.merchantReply && (
        <div className="mt-5 border-l-2 border-mist pl-4">
          <p className="text-xs tracking-label text-navy-soft uppercase">
            SmileFam replied
          </p>
          <p className="prose-measure mt-1.5 text-sm leading-relaxed font-light text-navy">
            {review.merchantReply.body}
          </p>
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-soft">
        <span className="font-mono" title="Fingerprint of this review's text, checked against the raw harvest on every build">
          {review.provenance.bodySha256.slice(0, 8)}
        </span>
        {review.displayPolicy.attributionUrl && (
          <a
            href={review.displayPolicy.attributionUrl}
            rel="noopener nofollow"
            className="text-navy-soft underline decoration-silver underline-offset-4 transition-colors hover:decoration-navy-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            Read on {review.sourceLabel}
          </a>
        )}
      </footer>
    </article>
  );
}

function Rating({
  rating,
  recommended,
}: {
  rating: number | null;
  recommended: boolean | null;
}) {
  // Facebook has no stars. Saying "Recommends" is the truth; rendering five
  // filled stars would invent a rating the reviewer never gave.
  if (rating === null) {
    if (recommended === null) return null;
    return (
      <span className="text-sm font-medium text-navy">
        {recommended ? "Recommends" : "Does not recommend"}
      </span>
    );
  }

  return (
    <span className="text-sm text-navy" aria-label={`${rating} out of 5 stars`}>
      <span aria-hidden>{"★".repeat(Math.round(rating))}</span>
      <span aria-hidden className="text-mist">
        {"★".repeat(5 - Math.round(rating))}
      </span>
    </span>
  );
}

function SourceBadge({ review }: { review: Review }) {
  return (
    <span className="rounded-xs bg-mist px-2 py-0.5 font-medium text-navy">
      {review.sourceLabel}
    </span>
  );
}

/**
 * The badge has to be literally true, per source. This is the highest-trust
 * element on the page and the easiest one to quietly overstate.
 *
 * - Stamped and Shopee can link a review to an order → "Verified purchase".
 * - A Stamped review without that link is still a review submitted to the
 *   store, NOT something posted publicly — calling it a "public review" would
 *   be inaccurate in the other direction.
 * - Google and Facebook reviews are public and unverifiable, and say so.
 */
function VerificationBadge({ review }: { review: Review }) {
  const verified =
    review.verificationBasis === "platform-verified-buyer" ||
    review.verificationBasis === "platform-order-linked";

  if (verified) {
    return <span className="font-medium text-navy">Verified purchase</span>;
  }

  const label =
    review.source === "stamped"
      ? "Submitted to the store — purchase not verified"
      : "Public review — purchase not verified";

  return <span className="text-navy-soft">{label}</span>;
}

/**
 * Renders only photos we are entitled to serve.
 *
 * `rehosted` is false for every Google, Shopee and Facebook image (platform ToS
 * plus reviewer copyright) and for any Stamped photo whose download failed. The
 * guard lives here so the policy cannot be bypassed by a future caller.
 */
function ReviewPhoto({
  photo,
  author,
  productName,
}: {
  photo: ReviewPhotoType;
  author: string;
  productName: string | null;
}) {
  if (!photo.rehosted || !photo.src || !photo.width || !photo.height) {
    return null;
  }

  return (
    <Image
      src={photo.src}
      width={photo.width}
      height={photo.height}
      alt={`SmileFam ${productName ?? "teeth whitening"} — customer photo by ${author}`}
      placeholder={photo.blurDataUrl ? "blur" : "empty"}
      blurDataURL={photo.blurDataUrl ?? undefined}
      loading="lazy"
      decoding="async"
      sizes="152px"
      className="h-auto w-[9.5rem] rounded-sm object-cover"
    />
  );
}
