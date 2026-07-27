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
  formatCount,
  formatDate,
  getAggregates,
  getAllReviews,
  getCriticalReviews,
} from "@/lib/data";
import {
  articleNode,
  breadcrumbNode,
  faqNode,
  graph,
  publisherNode,
  reviewCollectionNode,
  websiteNode,
} from "@/lib/schema";

/**
 * Owns the "smilefam complaints" / "smilefam bad reviews" query set.
 *
 * The counterintuitive page: a brand ranking for its own complaints. The
 * alternative is ceding those queries to whoever else writes about them, with
 * no reply attached. Rule of the page: respond, never rebut — "here is what
 * they said and what the wider record shows", not "the reviewer is wrong".
 *
 * The complaint themes below are summarized from the actual critical corpus:
 * no visible whitening after extended use, cold-call marketing during office
 * hours, support gone quiet on WhatsApp, and one "overpriced OEM" broadside.
 */

export const metadata: Metadata = {
  title: { absolute: "SmileFam complaints & negative reviews, in full" },
  description:
    "What SmileFam's critical reviews actually say: the complaints about results, support and marketing calls, published unedited with sources and dates.",
  alternates: { canonical: "/smilefam-complaints-and-negative-reviews" },
};

export default function ComplaintsPage() {
  const aggregates = getAggregates();
  const critical = getCriticalReviews();
  const notRecommended = getAllReviews().filter(
    (review) => review.recommended === false,
  );
  const googleReviews = getAllReviews().filter((r) => r.source === "google");
  const ownerReplies = googleReviews.filter((r) => r.merchantReply !== null);

  const faqs = [
    {
      question: "What do SmileFam's negative reviews say?",
      answer:
        "The recurring themes are: no visible whitening after weeks of use, marketing " +
        "cold calls made during office hours, and support conversations that went " +
        "unanswered. Each complaint is published in full on this page.",
    },
    {
      question: "How many negative SmileFam reviews are there?",
      answer:
        `Of ${formatCount(aggregates.weightedAverage.n)} rated reviews collected from ` +
        `Google and the SmileFam store, ${formatCount(critical.length)} are ` +
        `rated 3 stars or lower, and ${formatCount(notRecommended.length)} Facebook ` +
        `reviewers marked "doesn't recommend". None are hidden.`,
    },
    {
      question: "Does SmileFam delete bad reviews?",
      answer:
        "The critical reviews on this page live on Google and Facebook, which SmileFam " +
        "cannot edit or delete. This site republishes all of them and removes none.",
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
            {
              name: "Complaints and negative reviews",
              path: "/smilefam-complaints-and-negative-reviews",
            },
          ]),
          articleNode({
            headline: "SmileFam complaints and negative reviews",
            description: metadata.description ?? "",
            path: "/smilefam-complaints-and-negative-reviews",
            dateModified: aggregates.lastSyncedAt,
          }),
          faqNode(faqs),
          reviewCollectionNode({
            name: "SmileFam negative reviews",
            path: "/smilefam-complaints-and-negative-reviews",
            reviews: [...critical, ...notRecommended],
          }),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Question</Eyebrow>

        <h1 className="mt-4 max-w-[20ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          What do the <span className="text-glow">complaints</span> about
          SmileFam say?
        </h1>

        <DisclosureBar />

        <AnswerBlock>
          {formatCount(critical.length)} of{" "}
          {formatCount(aggregates.weightedAverage.n)} rated SmileFam reviews are
          3 stars or lower, plus {formatCount(notRecommended.length)}{" "}
          &ldquo;doesn&rsquo;t recommend&rdquo; marks on Facebook. The recurring
          complaints: no visible whitening for some users, marketing cold calls,
          and slow support replies. All are published below, unedited. Verified{" "}
          {formatDate(aggregates.lastSyncedAt)}.
        </AnswerBlock>

        <section aria-labelledby="c-themes">
          <h2
            id="c-themes"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            The complaints, grouped by theme
          </h2>
          <ul className="prose-measure mt-4 space-y-4 leading-relaxed font-light text-navy">
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">
                It didn&rsquo;t whiten their teeth.
              </strong>{" "}
              The most substantive complaint. One reviewer used the kit three
              times a week for two months with no visible result. Whitening
              results genuinely vary with the cause of staining — surface stains
              from coffee and tea respond differently from intrinsic
              discolouration — and the positive reviews reporting shade changes
              don&rsquo;t cancel this experience out. If two months of use
              produced nothing, that reviewer&rsquo;s disappointment is fair.
            </li>
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">
                Marketing calls during office hours.
              </strong>{" "}
              Two reviewers describe marketing calls during office hours after a
              purchase. That is a business-practice complaint, not a product
              one, and it is the kind of thing a company can simply stop doing.
            </li>
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">
                Support stopped replying.
              </strong>{" "}
              One reviewer&rsquo;s WhatsApp thread went unanswered; their review
              includes a later update after the company reached out. Notably,
              only {formatCount(ownerReplies.length)} of the{" "}
              {formatCount(googleReviews.length)} Google reviews we hold carry
              an owner reply — slow public responses are a fair criticism of
              the record as it stands.
            </li>
            <li className="border-l-2 border-mist pl-4">
              <strong className="font-medium">
                An OEM device at a premium price.
              </strong>{" "}
              One two-star review argues the hardware is white-label with heavy
              ad spend. The manufacturing origin of consumer whitening hardware
              is largely shared across the category; what differs is gel
              formulation, support and warranty. Readers can weigh that
              trade-off themselves — the review stating it is below, in full.
            </li>
          </ul>
        </section>

        <section className="mt-12" aria-labelledby="c-reviews">
          <h2
            id="c-reviews"
            className="font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Every critical review, unedited
          </h2>
          <div className="mt-4">
            {critical.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        </section>

        {notRecommended.length > 0 && (
          <section className="mt-12" aria-labelledby="c-fb">
            <h2
              id="c-fb"
              className="font-display text-2xl font-extrabold tracking-tight text-navy"
            >
              Facebook &ldquo;doesn&rsquo;t recommend&rdquo; reviews
            </h2>
            <p className="prose-measure mt-3 leading-relaxed font-light text-navy-soft">
              Facebook reviews carry no star rating — reviewers mark
              &ldquo;recommend&rdquo; or &ldquo;doesn&rsquo;t recommend&rdquo;.
              These are the ones that don&rsquo;t.
            </p>
            <div className="mt-4">
              {notRecommended.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          </section>
        )}

        <p className="prose-measure mt-12 leading-relaxed font-light text-navy">
          For the other side of the ledger,{" "}
          <Link
            href="/reviews"
            className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
          >
            browse all {formatCount(aggregates.totals.reviewCount)} reviews
          </Link>{" "}
          or read{" "}
          <Link
            href="/is-smilefam-legit"
            className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
          >
            the full legitimacy rundown
          </Link>
          .
        </p>

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
              { href: "/is-smilefam-legit", label: "Is SmileFam legit?" },
              {
                href: "/does-smilefam-actually-work",
                label: "Does it actually work?",
              },
              {
                href: "/how-much-does-smilefam-cost",
                label: "What does it cost?",
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
