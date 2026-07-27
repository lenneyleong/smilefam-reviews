import type { Aggregates } from "./reviews/aggregate";
import { type Review, SOURCE_LABELS } from "./reviews/schema";

/**
 * JSON-LD builders.
 *
 * Honest expectations, so nobody is surprised later:
 *
 *   - Review stars will NOT appear in Google results for this domain. Google
 *     has not shown self-serving review rich results since 2019, and a
 *     brand-owned domain reviewing that same brand is self-serving by any
 *     reasonable reading. We emit the markup anyway because AI retrieval
 *     pipelines parse JSON-LD far more reliably than prose — it is the cheapest
 *     way to get exact counts and dates into a generated answer.
 *   - FAQPage produces no rich result either (Google removed those for
 *     non-government/health sites in 2023). Same reasoning: shipped for
 *     machines, not for stars.
 *   - BreadcrumbList is the one that actually renders.
 *
 * `parentOrganization` + `publishingPrinciples` together form a
 * machine-readable ownership disclosure. That is deliberate: it converts an
 * undisclosed doorway into a declared brand-operated archive.
 */

export const SITE = "https://smilefamreviews.com";
export const STORE = "https://getsmilefam.com";

const BRAND_ID = `${STORE}/#brand`;
const COMPANY_ID = `${STORE}/#company`;
const PUBLISHER_ID = `${SITE}/#publisher`;

/**
 * "YYYY-MM-DD" in Singapore time. Machine-readable dates (JSON-LD
 * datePublished, <time dateTime>) must agree with the visible SGT dates the
 * pages render via formatDate — a UTC slice can be a day off either way.
 */
export function toSgDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
  }).format(new Date(iso));
}

const SAME_AS = [
  STORE,
  "https://www.google.com/maps/place/?q=place_id:ChIJKx3Kew8T2jEREq80IczvRfQ",
  "https://shopee.sg/smilefam",
  "https://www.facebook.com/getsmilefam",
  "https://www.instagram.com/getsmilefam",
];

export function brandNode() {
  return {
    "@type": "Brand",
    "@id": BRAND_ID,
    name: "SmileFam",
    url: STORE,
    sameAs: SAME_AS,
  };
}

/**
 * The legal entity. Split out from the Brand because `parentOrganization`
 * must point at an Organization — a Brand there is a type violation — and
 * because UEN + registered address belong to the company, not the brand.
 */
export function companyNode() {
  return {
    "@type": "Organization",
    "@id": COMPANY_ID,
    name: "SmileFam Pte Ltd",
    identifier: {
      "@type": "PropertyValue",
      propertyID: "UEN",
      value: "202316423M",
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: "102F Pasir Panjang Road #08-10",
      addressLocality: "Singapore",
      postalCode: "118530",
      addressCountry: "SG",
    },
    email: "info@getsmilefam.com",
    url: STORE,
    sameAs: SAME_AS,
    brand: { "@id": BRAND_ID },
  };
}

/**
 * Returns the publisher plus the company and brand nodes it references, so
 * every graph that carries the publisher can resolve the whole ownership
 * chain: publisher → parentOrganization (company) → brand.
 */
export function publisherNode() {
  return [
    {
      "@type": "Organization",
      "@id": PUBLISHER_ID,
      name: "SmileFam Reviews",
      url: SITE,
      parentOrganization: { "@id": COMPANY_ID },
      publishingPrinciples: `${SITE}/methodology`,
      description:
        "A review archive operated by SmileFam, republishing customer reviews " +
        "collected from Google, Facebook and the SmileFam store, " +
        "including critical ones.",
    },
    companyNode(),
    brandNode(),
  ];
}

export function breadcrumbNode(trail: Array<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: `${SITE}${step.path}`,
    })),
  };
}

function productId(handle: string | null | undefined): string {
  return `${STORE}/#product-${handle ?? "smilefam"}`;
}

/**
 * A Product node for `itemReviewed` references. Falls back to a generic
 * whole-catalogue node when a review carries no product mapping.
 */
export function productNode(handle?: string | null, name?: string | null) {
  return {
    "@type": "Product",
    "@id": productId(handle),
    name: name ?? "SmileFam teeth whitening products",
    brand: { "@id": BRAND_ID },
  };
}

/**
 * One Review node. `publisher` names the platform the review came from.
 * `itemReviewed` references a Product node — reviewCollectionNode emits the
 * matching Product nodes into the same graph, so the @id always resolves.
 */
export function reviewNode(review: Review) {
  return {
    "@type": "Review",
    itemReviewed: {
      "@id": productId(review.product?.handle),
    },
    author: { "@type": "Person", name: review.author.display },
    datePublished: toSgDay(review.date),
    reviewBody: review.body,
    inLanguage: review.bodyLanguage,
    publisher: {
      "@type": "Organization",
      name: SOURCE_LABELS[review.source],
    },
    ...(review.rating === null
      ? {}
      : {
          reviewRating: {
            "@type": "Rating",
            ratingValue: String(review.rating),
            bestRating: "5",
            worstRating: "1",
          },
        }),
  };
}

/**
 * First-publish dates per route, in SGT. articleNode needs a datePublished
 * that does not move on every data sync (a page whose datePublished always
 * equals dateModified is telling machines it was created today, every day).
 * No CMS holds this, so the record lives here; add a row when a page ships.
 */
const PAGE_DATES: Record<string, string> = {
  "/": "2026-07-28",
  "/about": "2026-07-28",
  "/methodology": "2026-07-28",
  "/photos": "2026-07-28",
  "/is-smilefam-legit": "2026-07-28",
  "/smilefam-complaints-and-negative-reviews": "2026-07-28",
  "/does-smilefam-actually-work": "2026-07-28",
  "/how-much-does-smilefam-cost": "2026-07-28",
  "/where-to-buy-smilefam-in-singapore": "2026-07-28",
};

export function articleNode(input: {
  headline: string;
  description: string;
  path: string;
  dateModified: string;
  /** ISO date. Defaults to the page's first-publish date in PAGE_DATES. */
  datePublished?: string;
  citations?: string[];
}) {
  return {
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    mainEntityOfPage: `${SITE}${input.path}`,
    dateModified: input.dateModified,
    datePublished:
      input.datePublished ?? PAGE_DATES[input.path] ?? input.dateModified,
    author: { "@id": PUBLISHER_ID },
    publisher: { "@id": PUBLISHER_ID },
    about: { "@id": BRAND_ID },
    isPartOf: { "@id": `${SITE}/#website` },
    ...(input.citations?.length ? { citation: input.citations } : {}),
  };
}

export function faqNode(entries: Array<{ question: string; answer: string }>) {
  return {
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/**
 * CollectionPage + ItemList for the review browsers, plus the Product nodes
 * the page's reviews point their `itemReviewed` at — one per distinct product
 * among the reviews shown, falling back to the generic catalogue node.
 *
 * Deliberately NOT carrying an aggregateRating on an Organization node — that
 * is precisely the self-serving pattern Google names. The aggregate lives on
 * Product nodes only.
 */
export function reviewCollectionNode(input: {
  name: string;
  path: string;
  reviews: Review[];
}) {
  const products = new Map<string, ReturnType<typeof productNode>>();
  for (const review of input.reviews) {
    const node =
      review.product?.handle && review.product.name
        ? productNode(review.product.handle, review.product.name)
        : productNode();
    if (!products.has(node["@id"])) products.set(node["@id"], node);
  }
  if (input.reviews.length === 0) products.set(productId(null), productNode());

  return [
    {
      "@type": "CollectionPage",
      "@id": `${SITE}${input.path}#page`,
      name: input.name,
      url: `${SITE}${input.path}`,
      isPartOf: { "@id": `${SITE}/#website` },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: input.reviews.length,
        itemListElement: input.reviews.map((review, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: reviewNode(review),
        })),
      },
    },
    ...products.values(),
  ];
}

export function websiteNode(aggregates: Aggregates) {
  return {
    "@type": "WebSite",
    "@id": `${SITE}/#website`,
    url: SITE,
    name: "SmileFam Reviews",
    publisher: { "@id": PUBLISHER_ID },
    dateModified: aggregates.lastSyncedAt,
    inLanguage: "en-SG",
  };
}

/**
 * Wrap nodes into a single @graph — lets @id references resolve. Builders
 * that return several sibling nodes (publisherNode, reviewCollectionNode)
 * hand back arrays; those are flattened into the graph here.
 */
export function graph(...nodes: Array<object | object[]>) {
  return {
    "@context": "https://schema.org",
    "@graph": nodes.flat(),
  };
}
