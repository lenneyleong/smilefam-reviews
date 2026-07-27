import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReviewBrowser } from "@/components/ReviewBrowser";
import {
  FACETS,
  MAX_PAGES,
  PAGE_SIZE,
  getFacet,
  paginate,
  sortForBrowsing,
} from "@/lib/browse";
import { formatCount } from "@/lib/data";

/** Deep pages for each facet. Self-canonical, same rules as /reviews/page/N. */

export const dynamicParams = false;

export function generateStaticParams() {
  const params: Array<{ facet: string; n: string }> = [];
  for (const facet of FACETS) {
    if (facet.slug === "critical") continue;
    const total = Math.min(
      Math.ceil(facet.select().length / PAGE_SIZE),
      MAX_PAGES,
    );
    for (let n = 2; n <= total; n += 1) {
      params.push({ facet: facet.slug, n: String(n) });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ facet: string; n: string }>;
}): Promise<Metadata> {
  const { facet: slug, n } = await params;
  const facet = getFacet(slug);
  if (!facet) return {};
  const total = Math.min(
    Math.ceil(facet.select().length / PAGE_SIZE),
    MAX_PAGES,
  );
  return {
    title: `${facet.title} — page ${n}`,
    description: `${facet.metaDescription} Page ${n} of ${total}.`,
    alternates: { canonical: `/reviews/${slug}/page/${n}` },
  };
}

export default async function FacetPageN({
  params,
}: {
  params: Promise<{ facet: string; n: string }>;
}) {
  const { facet: slug, n } = await params;
  const facet = getFacet(slug);
  const page = Number(n);
  if (!facet || page < 2) notFound();

  const data = paginate(sortForBrowsing(facet.select()), page);
  if (!data) notFound();

  return (
    <ReviewBrowser
      data={data}
      headingText={facet.title}
      heading={facet.title}
      intro={
        <p>
          Page {data.page} of {data.totalPages} —{" "}
          {formatCount(data.totalReviews)} reviews in this view.
        </p>
      }
      basePath={`/reviews/${facet.slug}`}
      activeFacet={facet.slug}
    />
  );
}
