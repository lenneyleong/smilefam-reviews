import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import {
  DataProvenance,
  DisclosureBar,
  Eyebrow,
} from "@/components/PageFurniture";
import { ReviewCard } from "@/components/ReviewCard";
import type { PageOfReviews } from "@/lib/browse";
import { FACETS } from "@/lib/browse";
import { formatCount, getAggregates } from "@/lib/data";
import {
  breadcrumbNode,
  graph,
  publisherNode,
  reviewCollectionNode,
  websiteNode,
} from "@/lib/schema";

/**
 * Shared layout for every review-list page: /reviews, its pagination, and each
 * facet. One component so pagination is guaranteed to be real <a href> links
 * everywhere — crawlers and non-JS AI bots must be able to walk every page.
 * No "Load more", no infinite scroll (both a crawl problem and Lenney's
 * explicit call).
 */

interface ReviewBrowserProps {
  data: PageOfReviews;
  heading: React.ReactNode;
  /** Plain-text heading for schema + breadcrumbs. */
  headingText: string;
  intro: React.ReactNode;
  /** Path without pagination, e.g. "/reviews" or "/reviews/google". */
  basePath: string;
  activeFacet?: string;
}

export function ReviewBrowser({
  data,
  heading,
  headingText,
  intro,
  basePath,
  activeFacet,
}: ReviewBrowserProps) {
  const aggregates = getAggregates();
  const currentPath =
    data.page === 1 ? basePath : `${basePath}/page/${data.page}`;

  const trail = [
    { name: "SmileFam Reviews", path: "/" },
    { name: "All reviews", path: "/reviews" },
  ];
  if (basePath !== "/reviews") trail.push({ name: headingText, path: basePath });
  if (data.page > 1)
    trail.push({ name: `Page ${data.page}`, path: currentPath });

  return (
    <>
      <JsonLd
        data={graph(
          publisherNode(),
          websiteNode(aggregates),
          breadcrumbNode(trail),
          reviewCollectionNode({
            name: `${headingText}${data.page > 1 ? ` — page ${data.page}` : ""}`,
            path: currentPath,
            reviews: data.reviews,
          }),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>
          {formatCount(data.totalReviews)} reviews
          {data.totalPages > 1 && ` · page ${data.page} of ${data.totalPages}`}
        </Eyebrow>

        <h1 className="mt-4 max-w-[20ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          {heading}
        </h1>

        <DisclosureBar />

        <div className="prose-measure mt-8 text-lg leading-relaxed font-light text-navy">
          {intro}
        </div>

        <FacetNav active={activeFacet} />

        <section className="mt-8" aria-labelledby="review-list">
          {/* Cards render h3s — without this h2 every list page jumps h1→h3. */}
          <h2 id="review-list" className="sr-only">
            {headingText}
            {data.page > 1 ? ` — page ${data.page}` : ""}
          </h2>
          {data.reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
          {data.reviews.length === 0 && (
            <p className="mt-4 font-light text-navy-soft">
              No reviews match this view yet.
            </p>
          )}
        </section>

        <Pagination basePath={basePath} data={data} />

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}

/**
 * Facet navigation — plain links, one per allowlisted facet. This block is also
 * what internally links every facet from every browse page, so none of them is
 * an orphan.
 */
function FacetNav({ active }: { active?: string }) {
  return (
    <nav aria-label="Filter reviews" className="mt-8 border-y border-mist py-4">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <li>
          <FacetLink href="/reviews" isActive={active === undefined}>
            All
          </FacetLink>
        </li>
        {FACETS.map((facet) => (
          <li key={facet.slug}>
            <FacetLink
              href={`/reviews/${facet.slug}`}
              isActive={active === facet.slug}
            >
              {facet.navLabel}
            </FacetLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function FacetLink({
  href,
  isActive,
  children,
}: {
  href: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? "font-medium text-navy underline decoration-navy decoration-2 underline-offset-4"
          : "font-light text-navy-soft underline decoration-transparent underline-offset-4 transition-colors hover:decoration-silver focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
      }
    >
      {children}
    </Link>
  );
}

/**
 * Real prev/next anchors plus a compact page list. rel=prev/next hints retired
 * years ago as a Google signal, but the plain links are what crawlers actually
 * walk — they are the mechanism, not a hint.
 */
function Pagination({
  basePath,
  data,
}: {
  basePath: string;
  data: PageOfReviews;
}) {
  if (data.totalPages <= 1) return null;

  const pageHref = (n: number) => (n === 1 ? basePath : `${basePath}/page/${n}`);

  // First, last, and a window around the current page — plus a decade rail
  // (10, 20, 30…) so any page is reachable in ~3 hops instead of a 20-plus
  // click walk. Crawl depth is ranking-relevant and the rail is cheap.
  const window = new Set<number>([1, data.totalPages]);
  for (let n = data.page - 2; n <= data.page + 2; n += 1) {
    if (n >= 1 && n <= data.totalPages) window.add(n);
  }
  for (let n = 10; n < data.totalPages; n += 10) window.add(n);
  const pages = [...window].sort((a, b) => a - b);

  return (
    <nav aria-label="Pages" className="mt-10 border-t border-mist pt-6">
      <ul className="flex flex-wrap items-baseline gap-x-2 gap-y-2 text-sm">
        {data.page > 1 && (
          <li className="mr-2">
            <Link
              href={pageHref(data.page - 1)}
              className="font-medium text-navy underline decoration-silver underline-offset-4 hover:decoration-navy"
            >
              ← Newer
            </Link>
          </li>
        )}

        {pages.map((n, index) => {
          const gap = index > 0 && n - pages[index - 1]! > 1;
          return (
            <li key={n} className="flex items-baseline gap-2">
              {gap && <span aria-hidden className="text-navy-soft">…</span>}
              {n === data.page ? (
                <span
                  aria-current="page"
                  className="rounded-xs bg-navy px-2.5 py-1 font-medium text-white"
                >
                  {n}
                </span>
              ) : (
                <Link
                  href={pageHref(n)}
                  className="px-1.5 py-1 font-light text-navy-soft underline decoration-transparent underline-offset-4 hover:decoration-silver"
                >
                  {n}
                </Link>
              )}
            </li>
          );
        })}

        {data.page < data.totalPages && (
          <li className="ml-2">
            <Link
              href={pageHref(data.page + 1)}
              className="font-medium text-navy underline decoration-silver underline-offset-4 hover:decoration-navy"
            >
              Older →
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
