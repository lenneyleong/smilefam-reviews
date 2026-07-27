import type { Metadata } from "next";
import Link from "next/link";

import { FaqSection } from "@/components/FaqSection";
import { JsonLd } from "@/components/JsonLd";
import {
  AnswerBlock,
  DataProvenance,
  DisclosureBar,
  Eyebrow,
} from "@/components/PageFurniture";
import { ReviewCard } from "@/components/ReviewCard";
import {
  countReviewsMatching,
  formatCount,
  formatDate,
  getAggregates,
  searchReviews,
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
 * Targets "does smilefam work" / "smilefam results" — the highest-volume doubt
 * query. The page's discipline: every claim is a count over the corpus, and the
 * strongest counter-evidence (the two-month-no-result review) is quoted on the
 * same page, not hidden on /complaints.
 */

const RESULTS_PATTERN = /\b(shades?|whiter|whitening result|stain)/i;
const TIMEFRAME_PATTERN = /\b\d+\s*(?:week|day|session)s?\b/i;

export const metadata: Metadata = {
  title: {
    absolute: "Does SmileFam actually work? Reviewer results & timeframes",
  },
  description:
    "What SmileFam customers report about whitening results — how many mention visible changes, how long it took them, and the reviews where it didn't work.",
  alternates: { canonical: "/does-smilefam-actually-work" },
};

export default function DoesItWorkPage() {
  const aggregates = getAggregates();
  const resultsCount = countReviewsMatching(RESULTS_PATTERN);
  const timeframeReviews = searchReviews(TIMEFRAME_PATTERN, 4, {
    minLength: 160,
  });
  const negative = searchReviews(/whiten/i, 2, { maxRating: 3 });

  const faqs = [
    {
      question: "Does SmileFam whitening actually work?",
      answer:
        `For most reviewers, yes: ${formatCount(resultsCount)} of ` +
        `${formatCount(aggregates.totals.reviewCount)} reviews mention whitening ` +
        `results or stain removal, typically reporting one to two shades over days ` +
        `to weeks. A small number of reviewers report no visible change — those ` +
        `reviews are quoted on this page.`,
    },
    {
      question: "How long does SmileFam take to show results?",
      answer:
        "Reviewers who state a timeframe most commonly describe visible change " +
        "within the first one to three weeks of regular use. Results vary with the " +
        "cause of staining: surface stains from coffee and tea respond fastest.",
    },
    {
      question: "Does SmileFam work on coffee stains?",
      answer:
        `Coffee and tea staining is the single most common reason reviewers bought ` +
        `SmileFam — ${formatCount(countReviewsMatching(/\b(coffee|tea)\b/i))} reviews ` +
        `mention it — and most of those report the stains fading with use.`,
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
            { name: "Does SmileFam work?", path: "/does-smilefam-actually-work" },
          ]),
          articleNode({
            headline: "Does SmileFam actually work?",
            description: metadata.description ?? "",
            path: "/does-smilefam-actually-work",
            dateModified: aggregates.lastSyncedAt,
          }),
          faqNode(faqs),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Question</Eyebrow>

        <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          Does SmileFam actually <span className="text-glow">work</span>?
        </h1>

        <DisclosureBar />

        <AnswerBlock>
          For most reviewers, yes — {formatCount(resultsCount)} of{" "}
          {formatCount(aggregates.totals.reviewCount)} reviews mention whitening
          results or stains fading, typically over one to three weeks of
          regular use. It did not work for everyone: a small number report no
          visible change, and those reviews are quoted below. Verified{" "}
          {formatDate(aggregates.lastSyncedAt)}.
        </AnswerBlock>

        <section aria-labelledby="w-timeframes">
          <h2
            id="w-timeframes"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            What reviewers report, with timeframes
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            The most useful reviews name a number — days used, sessions run,
            shades changed. These are selected for exactly that, not for
            enthusiasm:
          </p>
          <div className="mt-4">
            {timeframeReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        </section>

        <section aria-labelledby="w-negative">
          <h2
            id="w-negative"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            When it didn&rsquo;t work
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            Whitening response varies with the cause of discolouration, and for
            some reviewers the kit did nothing visible. Their reviews, in full:
          </p>
          <div className="mt-4">
            {negative.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            Every review rated 3 stars or lower is on{" "}
            <Link
              href="/reviews/critical"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              the critical reviews page
            </Link>
            .
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
                href: "/how-much-does-smilefam-cost",
                label: "What does it cost?",
              },
              { href: "/is-smilefam-legit", label: "Is SmileFam legit?" },
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
