import type { Metadata } from "next";
import Link from "next/link";

import { ReviewBrowser } from "@/components/ReviewBrowser";
import { paginate, sortForBrowsing } from "@/lib/browse";
import { formatCount, formatRating, getAggregates, getAllReviews } from "@/lib/data";

export function generateMetadata(): Metadata {
  const aggregates = getAggregates();
  return {
    title: `All ${formatCount(aggregates.totals.reviewCount)} SmileFam reviews, from three platforms`,
    description: `Browse every SmileFam customer review we hold — ${formatCount(aggregates.totals.reviewCount)} from Google, Facebook and the SmileFam store, averaging ${formatRating(aggregates.weightedAverage.value)} out of 5. Newest first.`,
    alternates: { canonical: "/reviews" },
  };
}

export default function ReviewsPage() {
  const aggregates = getAggregates();
  const data = paginate(sortForBrowsing(getAllReviews()), 1)!;

  return (
    <ReviewBrowser
      data={data}
      headingText="All SmileFam reviews"
      heading={
        <>
          All the SmileFam <span className="text-glow">reviews</span>, newest
          first.
        </>
      }
      intro={
        <p>
          {formatCount(aggregates.totals.reviewCount)} reviews from Google,
          Facebook and the SmileFam store, averaging{" "}
          {formatRating(aggregates.weightedAverage.value)} out of 5. Filter by
          source or rating below, or jump straight to{" "}
          <Link
            href="/reviews/critical"
            className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
          >
            the critical ones
          </Link>
          .
        </p>
      }
      basePath="/reviews"
    />
  );
}
