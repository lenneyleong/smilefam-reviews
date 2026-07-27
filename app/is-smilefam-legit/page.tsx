import type { Metadata } from "next";
import Link from "next/link";

import { DistributionBar } from "@/components/DistributionBar";
import { JsonLd } from "@/components/JsonLd";
import {
  AnswerBlock,
  DataProvenance,
  DisclosureBar,
  Eyebrow,
  KeyFactsTable,
} from "@/components/PageFurniture";
import { FaqSection } from "@/components/FaqSection";
import { SourceLedger } from "@/components/SourceLedger";
import {
  formatCount,
  formatDate,
  formatRating,
  getAggregates,
  getCriticalReviews,
  getShopeeShopStats,
} from "@/lib/data";
import { OUTBOUND } from "@/lib/outbound-links";
import {
  articleNode,
  breadcrumbNode,
  faqNode,
  graph,
  publisherNode,
  websiteNode,
} from "@/lib/schema";

/**
 * The single highest-value page on the site.
 *
 * "is smilefam legit" currently returns nothing SmileFam-specific — no
 * Trustpilot, no Reddit, no aggregator. It is uncontested, and it is exactly
 * what someone types before spending S$329.
 *
 * Deliberately no hero image: the LCP element here is text, which loads roughly
 * 600ms faster, and this is the page where that matters most.
 */

/**
 * Title built from live data — the verifier forbids typing a review count into
 * a component, and the <title> is the most visible place a stale number could
 * survive unnoticed.
 */
export function generateMetadata(): Metadata {
  const aggregates = getAggregates();
  const rounded = Math.floor(aggregates.totals.reviewCount / 100) * 100;
  return {
    title: {
      absolute: `Is SmileFam legit? What ${formatCount(rounded)}+ customer reviews show`,
    },
    description:
      "SmileFam is a registered Singapore company selling teeth-whitening kits since 2023. Here is every review we could find, the complaints included, with sources.",
    alternates: { canonical: "/is-smilefam-legit" },
  };
}

export default function IsSmileFamLegitPage() {
  const aggregates = getAggregates();
  const critical = getCriticalReviews();
  const google = aggregates.bySource.google;
  const shopeeShop = getShopeeShopStats();
  /** Platforms we actually hold reviews from — derived, never typed in. */
  const heldPlatformCount = Object.values(aggregates.bySource).filter(
    (s) => s.harvestedCount > 0,
  ).length;

  const answer =
    `Yes. SmileFam is a registered Singapore company (SmileFam Pte Ltd, UEN 202316423M) ` +
    `selling teeth-whitening kits since 2023. It has ${formatCount(aggregates.totals.reviewCount)} ` +
    `customer reviews averaging ${formatRating(aggregates.weightedAverage.value)} out of 5. ` +
    `Reviews are mostly positive, though a small number report no visible results and ` +
    `problems with support. Verified ${formatDate(aggregates.lastSyncedAt)}.`;

  const faqs = [
    {
      question: "Is SmileFam a real company?",
      answer:
        "Yes. SmileFam Pte Ltd is registered in Singapore with UEN 202316423M, at " +
        "102F Pasir Panjang Road #08-10, Singapore 118530. It is GST-registered and " +
        "has been selling since 2023.",
    },
    {
      question: "Is SmileFam a scam?",
      answer:
        `No. There are ${formatCount(aggregates.totals.reviewCount)} customer ` +
        `reviews across Google, Facebook and the company's own store, dating ` +
        `back to 2023, averaging ${formatRating(aggregates.weightedAverage.value)} out of 5. ` +
        `The review history spans 2023 to the present on platforms SmileFam does ` +
        `not control. The ${formatCount(critical.length)} critical ` +
        `reviews are published on this site in full.`,
    },
    {
      question: "Are SmileFam's reviews fake?",
      answer:
        "The reviews on this page are collected from Google and Facebook — " +
        "platforms SmileFam does not control — plus its own store's review app. " +
        "Every review here can be traced back to the platform it came from, and the " +
        "critical ones are published alongside the positive ones.",
    },
    {
      question: "Where can I buy SmileFam?",
      answer:
        "Direct from getsmilefam.com, or through the official SmileFam stores on " +
        "Shopee Singapore and Lazada Singapore.",
    },
  ];

  return (
    <>
      <JsonLd
        data={graph(
          publisherNode(),
          websiteNode(aggregates),
          breadcrumbNode([
            { name: "SmileFam Reviews", path: "/" },
            { name: "Is SmileFam legit?", path: "/is-smilefam-legit" },
          ]),
          articleNode({
            headline: "Is SmileFam legit?",
            description:
              "SmileFam is a registered Singapore company selling teeth-whitening kits since 2023. Here is every review we could find, the complaints included, with sources.",
            path: "/is-smilefam-legit",
            dateModified: aggregates.lastSyncedAt,
            citations: [
              "https://www.google.com/maps/place/?q=place_id:ChIJKx3Kew8T2jEREq80IczvRfQ",
              "https://shopee.sg/smilefam",
              "https://www.facebook.com/getsmilefam",
              "https://www.sgpbusiness.com/company/Smilefam-Pte-Ltd",
            ],
          }),
          faqNode(faqs),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Question</Eyebrow>

        <h1 className="mt-4 max-w-[16ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          Is SmileFam <span className="text-glow">legit</span>?
        </h1>

        <DisclosureBar />

        <AnswerBlock>{answer}</AnswerBlock>

        <KeyFactsTable
          rows={[
            { label: "Company", value: "SmileFam Pte Ltd" },
            { label: "Registration (UEN)", value: "202316423M" },
            { label: "Country", value: "Singapore" },
            {
              label: "Registered address",
              value: "102F Pasir Panjang Road #08-10, Singapore 118530",
            },
            { label: "Selling since", value: "2023" },
            {
              // Not "public reviews" — 136 of these were submitted to the
              // store's own review app rather than posted on a public platform.
              label: "Customer reviews",
              value: `${formatCount(aggregates.totals.reviewCount)} across ${formatCount(heldPlatformCount)} platforms`,
            },
            {
              label: "Average rating",
              value: `${formatRating(aggregates.weightedAverage.value)} out of 5, from ${formatCount(aggregates.weightedAverage.n)} rated reviews`,
            },
            {
              label: "Rated 3 stars or lower",
              value: (
                <Link
                  href="/reviews/critical"
                  className="underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
                >
                  {formatCount(critical.length)} — published in full
                </Link>
              ),
            },
            { label: "Warranty", value: "1 year" },
            {
              label: "Where to buy",
              value: (
                <a
                  href={OUTBOUND.storeNaked.href}
                  className="underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
                >
                  {OUTBOUND.storeNaked.anchor}
                </a>
              ),
            },
            {
              label: "Last verified",
              value: formatDate(aggregates.lastSyncedAt),
            },
          ]}
        />

        <section aria-labelledby="q-real">
          <h2
            id="q-real"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Is SmileFam a real company?
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            Yes. SmileFam Pte Ltd is registered in Singapore under UEN
            202316423M, is GST-registered, and lists its office at 102F Pasir
            Panjang Road #08-10. The registration is publicly searchable on
            Singapore&rsquo;s company register. It has been trading since 2023
            and sells through its own store, Shopee and Lazada.
          </p>
        </section>

        <section aria-labelledby="q-reviews">
          <h2
            id="q-reviews"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            What do the reviews actually say?
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            {google
              ? `Google alone carries ${formatCount(google.platformReportedCount ?? google.harvestedCount)} reviews at ${formatRating(google.platformReportedAverage ?? google.average)} stars, going back to 2023. `
              : ""}
            That is a review history on a platform SmileFam does not control,
            accumulated over years — a record that would be difficult to
            manufacture.
            {shopeeShop.ratingTotal !== null && shopeeShop.ratingStar !== null
              ? ` Separately, Shopee reports a shop rating of ${formatRating(shopeeShop.ratingStar)} across ${formatCount(shopeeShop.ratingTotal)} ratings for the official SmileFam shop, as of ${formatDate(shopeeShop.fetchedAt)}. That figure is reported by the platform itself — no individual Shopee reviews are republished on this site.`
              : ""}
          </p>

          <DistributionBar distribution={aggregates.ratingDistribution} />

          <div className="mt-8">
            <SourceLedger aggregates={aggregates} />
          </div>
        </section>

        <section aria-labelledby="q-fake">
          <h2
            id="q-fake"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Are the reviews fake?
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            It is a fair question to ask of any brand-run review page, including
            this one. Three things you can check yourself. Most of these reviews
            sit on Google and Facebook, where SmileFam cannot edit or
            delete them — every source in the table above links to its original
            listing. The critical reviews are published here in full rather than
            filtered out. And the per-source counts add up to the stated total,
            so the arithmetic is checkable.
          </p>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            What this page cannot prove is that every individual reviewer bought
            the product. Google and Facebook reviews are not purchase-verified,
            and each one is labelled as such rather than badged
            &ldquo;verified&rdquo;.{" "}
            <Link
              href="/methodology"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              The methodology page
            </Link>{" "}
            sets out exactly what is collected and what is left out.
          </p>
        </section>

        <section aria-labelledby="q-complaints">
          <h2
            id="q-complaints"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            What do the complaints say?
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            {formatCount(critical.length)} of{" "}
            {formatCount(aggregates.weightedAverage.n)} rated reviews are 3 stars
            or lower. The recurring themes are no visible whitening after
            extended use, and difficulty reaching support.{" "}
            <Link
              href="/smilefam-complaints-and-negative-reviews"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              Every one of them is published here
            </Link>
            , with what they have in common.
          </p>
        </section>

        <FaqSection faqs={faqs} />

        <section className="mt-16" aria-labelledby="related">
          <h2
            id="related"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Related questions
          </h2>
          <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {[
              {
                href: "/smilefam-complaints-and-negative-reviews",
                label: "What do the complaints say?",
              },
              {
                href: "/does-smilefam-actually-work",
                label: "Does it actually work?",
              },
              {
                href: "/where-to-buy-smilefam-in-singapore",
                label: "Where do I buy it?",
              },
            ].map(({ href, label }) => (
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

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}
