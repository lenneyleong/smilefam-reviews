import type { Metadata } from "next";
import Link from "next/link";

import { FaqSection } from "@/components/FaqSection";
import { JsonLd } from "@/components/JsonLd";
import {
  AnswerBlock,
  DataProvenance,
  Eyebrow,
} from "@/components/PageFurniture";
import { SourceLedger } from "@/components/SourceLedger";
import {
  countPromotionalReviews,
  formatCount,
  formatDate,
  getAggregates,
  getCriticalReviews,
} from "@/lib/data";
import {
  articleNode,
  breadcrumbNode,
  faqNode,
  graph,
  publisherNode,
  websiteNode,
} from "@/lib/schema";

/**
 * The page every other page's disclosure links to. Its job is to answer, in
 * plain terms, every "how do I know this isn't rigged?" question — including
 * the ones with slightly uncomfortable answers. The uncomfortable answers are
 * what make the comfortable ones believable.
 */

export const metadata: Metadata = {
  title: "How we collect SmileFam reviews — and what we leave out",
  description:
    "Where every review on this site comes from, how names and photos are handled, what gets filtered and why, and how to request a correction or removal.",
  alternates: { canonical: "/methodology" },
};

export default function MethodologyPage() {
  const aggregates = getAggregates();
  const critical = getCriticalReviews();
  const promotional = countPromotionalReviews();

  const stamped = aggregates.bySource.stamped;
  const google = aggregates.bySource.google;

  const faqs = [
    {
      question: "Do you remove negative reviews?",
      answer:
        `No. Every review rated 3 stars or lower that we hold — currently ` +
        `${formatCount(critical.length)} — is published in full at ` +
        `/reviews/critical, unedited.`,
    },
    {
      question: "Who runs this site?",
      answer:
        "SmileFam Pte Ltd (UEN 202316423M), the company whose products are reviewed. " +
        "That relationship is disclosed at the top of every page.",
    },
    {
      question: "How do I get a review corrected or removed?",
      answer:
        "Email info@getsmilefam.com. If you are the reviewer and want your review or " +
        "photo removed from this site, we remove it and record the removal — the " +
        "count on the site will drop accordingly.",
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
            { name: "Methodology", path: "/methodology" },
          ]),
          articleNode({
            headline: "How we collect SmileFam reviews",
            description: metadata.description ?? "",
            path: "/methodology",
            dateModified: aggregates.lastSyncedAt,
          }),
          faqNode(faqs),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Methodology</Eyebrow>

        <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          How these reviews are <span className="text-glow">collected</span> —
          and what we leave out.
        </h1>

        <AnswerBlock>
          This site is operated by SmileFam. Reviews are harvested from Google,
          Facebook and the SmileFam store&rsquo;s review app, republished
          with their source and date, and re-verified against the raw harvest on
          every update. Last updated {formatDate(aggregates.lastSyncedAt)}.
        </AnswerBlock>

        <section aria-labelledby="m-sources">
          <h2
            id="m-sources"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Where the reviews come from
          </h2>
          <div className="mt-5">
            <SourceLedger aggregates={aggregates} />
          </div>
          <p className="prose-measure mt-5 leading-relaxed font-light text-navy">
            The &ldquo;platform reports&rdquo; column is each platform&rsquo;s
            own count. Where it exceeds what we hold, the reason differs by
            source. For Google, the difference is reviews that carry a star
            rating but no written text
            {google?.discrepancy
              ? ` — ${formatCount(google.discrepancy)} of them`
              : ""}
            ; there is nothing to republish, so they are counted by the
            platform and not by us. For the SmileFam store, the gap is the
            photo-only filter described below. Shopee&rsquo;s figure is the
            platform&rsquo;s own shop rating — we hold no individual Shopee
            reviews, so its entire count is platform-reported. We never go the
            other way: we hold nothing a platform doesn&rsquo;t show.
          </p>
        </section>

        <section aria-labelledby="m-filtered">
          <h2
            id="m-filtered"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            What is filtered, exactly
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            Three filters apply, and none of them touches ratings:
          </p>
          <ul className="prose-measure mt-4 space-y-3 leading-relaxed font-light text-navy">
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">No-text reviews are skipped.</strong>{" "}
              A star with no words cannot be republished as a review. The gap is
              disclosed in the table above.
            </li>
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">
                Store reviews are currently limited to those with customer
                photos
              </strong>{" "}
              — {formatCount(stamped?.harvestedCount ?? 0)} of the{" "}
              {formatCount(stamped?.platformReportedCount ?? 0)} the store
              holds. This is a volume decision, not a rating one: every store
              review, photo or not, is five stars, so the cut changes no
              average. The store&rsquo;s app also holds a number of reviews it
              collected but never published; those are not on this site either
              — the exact count is recorded in the raw snapshot metadata
              committed with this site.
            </li>
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">
                Promotional-sounding reviews are demoted, not deleted.
              </strong>{" "}
              {formatCount(promotional)} reviews read like seeded or affiliate
              copy — checkmark feature lists, calls to action. They stay in the
              archive and in the counts, but they are never chosen as featured
              reviews.
            </li>
          </ul>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            Negative reviews are not filtered, demoted, or held back. All{" "}
            {formatCount(critical.length)} reviews rated 3 stars or lower are{" "}
            <Link
              href="/reviews/critical"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              published in full
            </Link>{" "}
            and linked from the site header and every review browser.
          </p>
        </section>

        <section aria-labelledby="m-verify">
          <h2
            id="m-verify"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            How you can check we didn&rsquo;t write these
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            Most reviews here live on platforms SmileFam cannot edit — Google
            and Facebook — and every review links to its source listing.
            Each review also shows a short fingerprint (the grey code in its
            footer): a cryptographic hash of the review text, computed from the
            raw data as it arrived from the platform. Before every site update,
            an automated check re-hashes every review against that raw record
            and fails the build on any mismatch. A review cannot be added,
            edited or invented here without breaking its fingerprint.
          </p>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            One honest limitation: Facebook does not provide links to
            individual reviews, so Facebook reviews link to the page&rsquo;s
            review listing rather than the exact review. Google reviews link
            directly to the individual review on Google Maps. On verification:
            a small number of store reviews are order-linked —{" "}
            {formatCount(aggregates.totals.verifiedBuyerCount)} of the{" "}
            {formatCount(stamped?.harvestedCount ?? 0)} we hold — and the rest
            are labelled &ldquo;submitted to the store — purchase not
            verified&rdquo;. Google and Facebook reviews are public and
            unverifiable, and are labelled exactly that.
          </p>
        </section>

        <section aria-labelledby="m-privacy">
          <h2
            id="m-privacy"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Names and photos
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            Reviewer names are shortened to first name and last initial before
            they are ever stored — full surnames never reach this site&rsquo;s
            records. Profile photos are never collected from any platform.
            Customer photos are shown only for reviews submitted to the
            SmileFam store, where customers uploaded them to the brand&rsquo;s
            own review app; photos posted on Google or Facebook stay on
            those platforms. Location data embedded in photo files is stripped
            before publishing.
          </p>
        </section>

        <section aria-labelledby="m-removal">
          <h2
            id="m-removal"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Corrections and removals
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            If you wrote one of these reviews and want it or your photo removed
            from this site, email{" "}
            <a
              href="mailto:info@getsmilefam.com"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              info@getsmilefam.com
            </a>
            . We remove it, record the removal, and the site&rsquo;s counts drop
            accordingly — removals are logged, not silently absorbed. The same
            address handles factual corrections.
          </p>
        </section>

        <FaqSection faqs={faqs} />

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}
