import type { Metadata } from "next";
import Link from "next/link";

import { DistributionBar } from "@/components/DistributionBar";
import { JsonLd } from "@/components/JsonLd";
import {
  DataProvenance,
  DisclosureBar,
  Eyebrow,
} from "@/components/PageFurniture";
import { ReviewCard } from "@/components/ReviewCard";
import {
  formatCount,
  formatRating,
  getAggregates,
  getAllReviews,
  getSubstantialReviews,
} from "@/lib/data";
import { OUTBOUND } from "@/lib/outbound-links";
import { graph, publisherNode, websiteNode } from "@/lib/schema";

export const metadata: Metadata = {
  title: {
    absolute: "SmileFam Reviews — every review, including the bad ones",
  },
  description:
    "Customer reviews of SmileFam collected from Google, Facebook and the SmileFam store, with the source and date for every one. Critical reviews included.",
  alternates: { canonical: "/" },
};

/** The questions a buyer asks before spending S$329 on a whitening kit. */
const BUYER_QUESTIONS = [
  { href: "/is-smilefam-legit", label: "Is SmileFam legit?" },
  {
    href: "/smilefam-complaints-and-negative-reviews",
    label: "What do the complaints say?",
  },
  { href: "/does-smilefam-actually-work", label: "Does it actually work?" },
  { href: "/how-much-does-smilefam-cost", label: "What does it cost?" },
  {
    href: "/where-to-buy-smilefam-in-singapore",
    label: "Where do I buy it?",
  },
] as const;

export default function HomePage() {
  const aggregates = getAggregates();
  const featured = getSubstantialReviews(4);
  const featuredIds = new Set(featured.map((review) => review.id));
  /**
   * Newest 24 inline. The full corpus lived here briefly and produced a 7.8 MB
   * homepage — slow enough that Lenney reversed the call. The everything-on-
   * one-page view moved to /all (linked below); the paginated browser is the
   * indexable surface. Fast homepage beats exhaustive homepage for both users
   * and rankings.
   */
  const newest = [...getAllReviews()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((review) => !featuredIds.has(review.id))
    .slice(0, 24);

  return (
    <>
      <JsonLd data={graph(publisherNode(), websiteNode(aggregates))} />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Google · Facebook · SmileFam store</Eyebrow>

        <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          Every review of SmileFam we could find, including the{" "}
          <span className="text-glow">bad</span> ones.
        </h1>

        <DisclosureBar />

        <p className="prose-measure mt-8 text-lg leading-relaxed font-light text-navy">
          At least {formatCount(aggregates.totals.reviewCount)}+ customer
          reviews, averaging{" "}
          {formatRating(aggregates.weightedAverage.value)} out of 5 across{" "}
          {formatCount(aggregates.weightedAverage.n)}{" "}
          rated reviews. These are
          the ones we&rsquo;ve collected from three platforms —
          more exist across SmileFam&rsquo;s other sales channels that
          aren&rsquo;t pulled in here yet. Every review below carries its
          source and its date.
        </p>

        <DistributionBar distribution={aggregates.ratingDistribution} />

        <section className="mt-16" aria-labelledby="featured">
          <h2
            id="featured"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Start with the ones that tell you something
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy-soft">
            Sorted by how much detail they contain, not by rating. A specific
            four-star review is worth more to you than a three-word five-star
            one.
          </p>

          <div className="mt-6">
            {featured.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="newest">
          <h2
            id="newest"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            The newest reviews
          </h2>

          <div className="mt-6">
            {newest.map((review) => (
              <ReviewCard key={review.id} review={review} headingLevel="h3" />
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            <Link
              href="/all"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
            >
              See all {formatCount(aggregates.totals.reviewCount)} on one page
            </Link>
            <Link
              href="/reviews"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
            >
              Browse by source or rating
            </Link>
            <Link
              href="/photos"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
            >
              See the customer photos
            </Link>
          </div>
        </section>

        <section className="mt-16" aria-labelledby="questions">
          <h2
            id="questions"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Questions people ask before buying
          </h2>
          <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {BUYER_QUESTIONS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="font-light text-navy underline decoration-mist underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="buy">
          <h2
            id="buy"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Buying
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            SmileFam sells direct at{" "}
            <a
              href={OUTBOUND.storeNaked.href}
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              {OUTBOUND.storeNaked.anchor}
            </a>
            , and through its official Shopee and Lazada stores. Prices change,
            so{" "}
            <a
              href={OUTBOUND.bluKitPrice.href}
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              {OUTBOUND.bluKitPrice.anchor}
            </a>{" "}
            rather than trusting a figure on this page.
          </p>
        </section>

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}
