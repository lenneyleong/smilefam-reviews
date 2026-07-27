import type { Metadata } from "next";
import Link from "next/link";

import {
  DataProvenance,
  DisclosureBar,
  Eyebrow,
} from "@/components/PageFurniture";
import { ReviewCard } from "@/components/ReviewCard";
import { formatCount, getAggregates, getAllReviews } from "@/lib/data";

/**
 * Every review on a single page — the "one shot, Ctrl-F everything" view.
 *
 * Deliberately noindex,follow: at ~8 MB this page can never be fast, and a
 * slow page in the index drags the site's Core Web Vitals field data down. The
 * paginated browser is the indexable copy of this exact content; this page
 * exists for humans who want the whole record in one scroll. Photos are
 * lazy-loaded, so the cost is text, not images.
 */

export const metadata: Metadata = {
  title: "Every SmileFam review on one page",
  description:
    "The complete SmileFam review archive on a single page — heavy, but all of it.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/all" },
};

export default function AllReviewsPage() {
  const aggregates = getAggregates();
  const reviews = [...getAllReviews()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
      <Eyebrow>The whole archive</Eyebrow>

      <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
        Every review, <span className="text-glow">one</span> page.
      </h1>

      <DisclosureBar />

      <p className="prose-measure mt-8 text-lg leading-relaxed font-light text-navy">
        All {formatCount(aggregates.totals.reviewCount)} reviews we hold, newest
        first. This page is heavy by design — if you want it faster or
        filtered,{" "}
        <Link
          href="/reviews"
          className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
        >
          use the review browser
        </Link>
        .
      </p>

      <section className="mt-10" aria-labelledby="all-reviews">
        {/* Cards render h3s — this h2 keeps the outline h1 → h2 → h3. */}
        <h2 id="all-reviews" className="sr-only">
          All reviews, newest first
        </h2>
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} headingLevel="h3" />
        ))}
      </section>

      <DataProvenance aggregates={aggregates} />
    </main>
  );
}
