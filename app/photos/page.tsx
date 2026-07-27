import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import {
  AnswerBlock,
  DataProvenance,
  DisclosureBar,
  Eyebrow,
} from "@/components/PageFurniture";
import {
  formatCount,
  formatDate,
  getAggregates,
  getReviewsWithPhotos,
} from "@/lib/data";
import { displayablePhotos } from "@/lib/reviews/schema";
import {
  breadcrumbNode,
  graph,
  publisherNode,
  toSgDay,
  websiteNode,
} from "@/lib/schema";

/**
 * Targets "smilefam before and after" / "smilefam photos".
 *
 * Every image here is a real customer upload from the store's review app —
 * EXIF-stripped, rehosted from our own origin, and linked back to the review it
 * came from. AI-generated "customer" imagery is banned outright across all of
 * Lenney's brands; this page is the proof of the opposite approach.
 */

export const metadata: Metadata = {
  title: "SmileFam customer photos — real before-and-after shots",
  description:
    "Customer-submitted SmileFam photos from reviews left on the SmileFam store: before-and-after whitening shots, unboxings and in-use pictures. No stock, no AI imagery.",
  alternates: { canonical: "/photos" },
};

export default function PhotosPage() {
  const aggregates = getAggregates();
  const reviews = getReviewsWithPhotos().sort(
    (a, b) =>
      displayablePhotos(b).length - displayablePhotos(a).length ||
      b.date.localeCompare(a.date),
  );

  // Cumulative image count before each review — gives every <Image> its
  // global position so loading strategy can be decided per image, not per row.
  const imageOffsets: number[] = [];
  let imageCount = 0;
  for (const review of reviews) {
    imageOffsets.push(imageCount);
    imageCount += displayablePhotos(review).length;
  }

  return (
    <>
      <JsonLd
        data={graph(
          publisherNode(),
          websiteNode(aggregates),
          breadcrumbNode([
            { name: "SmileFam Reviews", path: "/" },
            { name: "Customer photos", path: "/photos" },
          ]),
          {
            "@type": "ImageGallery",
            name: "SmileFam customer photos",
            url: "https://smilefamreviews.com/photos",
            description: metadata.description,
          },
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Photos</Eyebrow>

        <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          SmileFam before and after — real customer{" "}
          <span className="text-glow">photos</span>.
        </h1>

        <DisclosureBar />

        <AnswerBlock>
          {formatCount(aggregates.totals.photoCount)} photos across{" "}
          {formatCount(aggregates.totals.withPhotoCount)} store reviews —
          before-and-after shots, unboxings and in-use pictures.
          Location metadata is stripped before publishing; nothing is
          stock or AI-generated. Updated {formatDate(aggregates.lastSyncedAt)}.
        </AnswerBlock>

        <section className="mt-12" aria-label="Customer photo galleries">
          {reviews.map((review, reviewIndex) => {
            const photos = displayablePhotos(review);
            const anchor = `r-${review.dedupeKey.slice(0, 12)}`;
            return (
              <article
                key={review.id}
                id={anchor}
                className="photo-card scroll-mt-24 border-b border-mist py-8 last:border-b-0"
              >
                <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="font-medium text-navy">
                    {review.author.display}
                  </h2>
                  <time
                    dateTime={toSgDay(review.date)}
                    className="text-sm font-light text-navy-soft"
                  >
                    {formatDate(review.date)}
                  </time>
                  {review.product?.name && (
                    <span className="text-sm font-light text-navy-soft">
                      {review.product.name}
                    </span>
                  )}
                </header>

                <ul className="mt-4 flex flex-wrap gap-3">
                  {photos.map((photo, photoIndex) => {
                    // Global position of this image on the page: the LCP
                    // candidate loads eagerly, and only the first screenfuls
                    // pay the base64 blur-placeholder byte cost.
                    const imageIndex = imageOffsets[reviewIndex]! + photoIndex;
                    const isLcp = imageIndex === 0;
                    const withBlur = imageIndex < 12 && photo.blurDataUrl;
                    return (
                      <li key={photo.sha256}>
                        <Image
                          src={photo.src!}
                          width={photo.width!}
                          height={photo.height!}
                          alt={`SmileFam ${review.product?.name ?? "teeth whitening"} — customer photo by ${review.author.display}`}
                          placeholder={withBlur ? "blur" : "empty"}
                          blurDataURL={withBlur ? photo.blurDataUrl! : undefined}
                          priority={isLcp}
                          loading={isLcp ? "eager" : "lazy"}
                          decoding="async"
                          sizes="(max-width: 640px) 45vw, 200px"
                          className="h-auto w-[11rem] rounded-sm object-cover"
                        />
                      </li>
                    );
                  })}
                </ul>

                <p className="prose-measure mt-4 text-sm leading-relaxed font-light text-navy-soft">
                  {review.body.length > 220
                    ? `${review.body.slice(0, 220)}…`
                    : review.body}
                </p>
              </article>
            );
          })}
        </section>

        <p className="prose-measure mt-10 leading-relaxed font-light text-navy">
          Every photo belongs to a full review —{" "}
          <Link
            href="/reviews/with-photos"
            className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
          >
            read them with their complete text here
          </Link>
          . If you are wondering why a brand publishes its customers&rsquo;
          unretouched photos at all,{" "}
          <Link
            href="/about"
            className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
          >
            who runs this site and why
          </Link>{" "}
          explains the thinking.
        </p>

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}
