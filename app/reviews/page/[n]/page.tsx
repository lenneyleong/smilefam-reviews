import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReviewBrowser } from "@/components/ReviewBrowser";
import { MAX_PAGES, PAGE_SIZE, paginate, sortForBrowsing } from "@/lib/browse";
import { formatCount, getAllReviews } from "@/lib/data";

/**
 * /reviews/page/2 .. /reviews/page/N — all SSG'd, all self-canonical.
 *
 * Never canonical-to-page-1: each page holds distinct reviews, and pointing
 * them all at page 1 would tell crawlers the deep pages are duplicates, which
 * unindexes 95% of the corpus. Only pages 1–10 go in the sitemap; the rest are
 * reachable by walking the pagination links.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  const total = Math.min(
    Math.ceil(getAllReviews().length / PAGE_SIZE),
    MAX_PAGES,
  );
  return Array.from({ length: Math.max(total - 1, 0) }, (_, i) => ({
    n: String(i + 2),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const { n } = await params;
  const total = Math.min(
    Math.ceil(getAllReviews().length / PAGE_SIZE),
    MAX_PAGES,
  );
  return {
    title: `SmileFam reviews — page ${n}`,
    description: `SmileFam customer reviews, every one with its source and date. Page ${n} of ${total}.`,
    alternates: { canonical: `/reviews/page/${n}` },
  };
}

export default async function ReviewsPageN({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n } = await params;
  const page = Number(n);
  const data = paginate(sortForBrowsing(getAllReviews()), page);
  if (!data || page < 2) notFound();

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
          Page {data.page} of {data.totalPages} —{" "}
          {formatCount(data.totalReviews)} reviews in total, ordered newest
          first.
        </p>
      }
      basePath="/reviews"
    />
  );
}
