import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import {
  DataProvenance,
  DisclosureBar,
  Eyebrow,
} from "@/components/PageFurniture";
import { ReviewCard } from "@/components/ReviewCard";
import { formatCount, getAggregates, getCriticalReviews } from "@/lib/data";
import {
  breadcrumbNode,
  graph,
  publisherNode,
  reviewCollectionNode,
  websiteNode,
} from "@/lib/schema";

/**
 * Every review rated 3 stars or lower, unfiltered and indexable.
 *
 * This page is the reason the rest of the site is believable. A brand-owned
 * review archive that shows only its good ratings is indistinguishable from a
 * marketing page; publishing the bad ones in full, on an indexable route,
 * linked from the homepage hero, is the thing a fabricated site never does.
 *
 * It must stay complete. The moment a negative review is quietly dropped from
 * here, /methodology's claim that we do not remove them becomes false and the
 * whole property loses the only asset it has.
 */

export const metadata: Metadata = {
  title: "Every SmileFam review rated 3 stars or lower",
  description:
    "The critical SmileFam reviews, published in full and unedited — what customers complained about, with the source and date for each.",
  alternates: { canonical: "/reviews/critical" },
};

export default function CriticalReviewsPage() {
  const aggregates = getAggregates();
  const critical = getCriticalReviews();

  return (
    <>
      <JsonLd
        data={graph(
          publisherNode(),
          websiteNode(aggregates),
          breadcrumbNode([
            { name: "SmileFam Reviews", path: "/" },
            { name: "All reviews", path: "/reviews" },
            { name: "Critical reviews", path: "/reviews/critical" },
          ]),
          reviewCollectionNode({
            name: "SmileFam reviews rated 3 stars or lower",
            path: "/reviews/critical",
            reviews: critical,
          }),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>All reviews · Critical</Eyebrow>

        <h1 className="mt-4 max-w-[20ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          The critical SmileFam <span className="text-glow">reviews</span>, in
          full.
        </h1>

        <DisclosureBar />

        <section className="mt-14" aria-labelledby="why">
          <h2
            id="why"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Why this page exists
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            A review page showing nothing but five stars tells you nothing. You
            cannot tell a good product from a filtered page. So the complaints
            are here, at the same weight as everything else, and linked from the
            site header and every review browser.
          </p>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            Read them and decide for yourself whether the problems described are
            ones you would run into.{" "}
            <Link
              href="/methodology"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              How these were collected
            </Link>
            .
          </p>
        </section>

        <section className="mt-12" aria-labelledby="reviews">
          <h2
            id="reviews"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            {formatCount(critical.length)} reviews rated 3 stars or lower
          </h2>

          <div className="mt-4">
            {critical.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>

          {critical.length === 0 && (
            <p className="prose-measure mt-4 leading-relaxed font-light text-navy-soft">
              No reviews in the current dataset are rated 3 stars or lower.
            </p>
          )}
        </section>

        <p className="mt-10">
          <Link
            href="/reviews"
            className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
          >
            Browse all {formatCount(aggregates.totals.reviewCount)} reviews
          </Link>
        </p>

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}
