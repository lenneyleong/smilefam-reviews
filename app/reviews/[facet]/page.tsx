import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReviewBrowser } from "@/components/ReviewBrowser";
import { FACETS, getFacet, paginate, sortForBrowsing } from "@/lib/browse";
import { formatCount } from "@/lib/data";

/**
 * The allowlisted facets: /reviews/google, /reviews/facebook,
 * /reviews/verified-buyers, /reviews/with-photos, /reviews/5-star.
 *
 * "critical" has its own hand-built page (app/reviews/critical/) with the
 * editorial framing that page deserves, and "page" is the pagination segment —
 * both are static folders, which Next resolves ahead of this dynamic route.
 * dynamicParams=false means any other slug 404s instead of becoming an
 * accidental thin page.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return FACETS.filter((facet) => facet.slug !== "critical").map((facet) => ({
    facet: facet.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ facet: string }>;
}): Promise<Metadata> {
  const { facet: slug } = await params;
  const facet = getFacet(slug);
  if (!facet) return {};
  return {
    title: facet.title,
    description: facet.metaDescription,
    alternates: { canonical: `/reviews/${facet.slug}` },
  };
}

export default async function FacetPage({
  params,
}: {
  params: Promise<{ facet: string }>;
}) {
  const { facet: slug } = await params;
  const facet = getFacet(slug);
  if (!facet || slug === "critical") notFound();

  const data = paginate(sortForBrowsing(facet.select()), 1);
  if (!data) notFound();

  // "SmileFam Google reviews" → highlight the distinguishing word.
  const keyword = facet.title.replace("SmileFam ", "").split(" ")[0]!;

  return (
    <ReviewBrowser
      data={data}
      headingText={facet.title}
      heading={
        <>
          SmileFam <span className="text-glow">{keyword}</span>{" "}
          {facet.title.replace(`SmileFam ${keyword}`, "").trim() || "reviews"}
        </>
      }
      intro={
        <p>
          {formatCount(data.totalReviews)} reviews in this view.{" "}
          {facet.metaDescription}
        </p>
      }
      basePath={`/reviews/${facet.slug}`}
      activeFacet={facet.slug}
    />
  );
}
