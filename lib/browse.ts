import "server-only";

import {
  getAllReviews,
  getCriticalReviews,
  getReviewsBySource,
  getReviewsWithPhotos,
} from "./data";
import { displayablePhotos, type Review } from "./reviews/schema";

/**
 * The review browser's facet system.
 *
 * Only these facets exist as real routes. Source × rating × product × photo is
 * combinatorially infinite, and letting every combination become a URL is a
 * classic crawl trap — so the allowlist below is the complete set of indexable
 * review-list pages, each targeting a query someone actually types. Anything
 * else is client-side refinement on a canonical page.
 */

export const PAGE_SIZE = 24;

/**
 * High enough that the main browser reaches EVERY review (1,874 / 24 ≈ 79
 * pages). Raised from 40 when the homepage stopped listing the full corpus —
 * with the homepage fast, the paginated browser is the only crawl path that
 * covers everything, so it must actually cover everything. Every page goes in
 * the sitemap, and the pagination's decade rail keeps crawl depth shallow.
 */
export const MAX_PAGES = 90;

export interface Facet {
  slug: string;
  /** H1 and <title> base. Written for the query it targets. */
  title: string;
  /** Short label for the facet nav — no string surgery on `title`. */
  navLabel: string;
  /** The query this facet exists to answer. */
  metaDescription: string;
  select: () => Review[];
}

export const FACETS: Facet[] = [
  {
    slug: "google",
    navLabel: "Google",
    title: "SmileFam Google reviews",
    metaDescription:
      "Every written SmileFam review from its Google Business Profile, with dates. Collected directly from Google Maps.",
    select: () => getReviewsBySource("google"),
  },
  {
    slug: "facebook",
    navLabel: "Facebook",
    title: "SmileFam Facebook reviews",
    metaDescription:
      "SmileFam recommendations from Facebook, republished with dates. Facebook reviews carry no star rating, so none is shown.",
    select: () => getReviewsBySource("facebook"),
  },
  {
    slug: "verified-buyers",
    navLabel: "Verified buyers",
    title: "SmileFam verified buyer reviews",
    metaDescription:
      "The SmileFam reviews that Stamped could link to a specific order. Every other review on this site is labelled unverified.",
    select: () =>
      getAllReviews().filter(
        (r) =>
          r.verificationBasis === "platform-verified-buyer" ||
          r.verificationBasis === "platform-order-linked",
      ),
  },
  {
    slug: "with-photos",
    navLabel: "With photos",
    title: "SmileFam reviews with photos",
    metaDescription:
      "SmileFam customer reviews that include real customer photos — before-and-after shots, unboxings and in-use pictures.",
    select: getReviewsWithPhotos,
  },
  {
    slug: "5-star",
    navLabel: "5-star",
    title: "SmileFam 5-star reviews",
    metaDescription:
      "Every 5-star SmileFam review we hold, with source and date. Read alongside the critical reviews for the full picture.",
    select: () => getAllReviews().filter((r) => r.rating === 5),
  },
  {
    slug: "critical",
    navLabel: "Critical",
    title: "SmileFam critical reviews",
    metaDescription:
      "Every SmileFam review rated 3 stars or lower, published unedited with source and date. Nothing removed.",
    select: getCriticalReviews,
  },
];

export function getFacet(slug: string): Facet | undefined {
  return FACETS.find((facet) => facet.slug === slug);
}

/** Newest first — the default reading order everywhere in the browser. */
export function sortForBrowsing(reviews: Review[]): Review[] {
  return [...reviews].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      // Photo reviews first within a day: they carry more information.
      displayablePhotos(b).length - displayablePhotos(a).length,
  );
}

export interface PageOfReviews {
  reviews: Review[];
  page: number;
  totalPages: number;
  totalReviews: number;
}

export function paginate(all: Review[], page: number): PageOfReviews | null {
  const totalPages = Math.min(Math.ceil(all.length / PAGE_SIZE), MAX_PAGES);
  if (page < 1 || (page > totalPages && !(page === 1 && all.length === 0))) {
    return null;
  }
  return {
    reviews: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    totalPages,
    totalReviews: all.length,
  };
}
