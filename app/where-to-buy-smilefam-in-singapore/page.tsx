import type { Metadata } from "next";
import Link from "next/link";

import { FaqSection } from "@/components/FaqSection";
import { JsonLd } from "@/components/JsonLd";
import {
  AnswerBlock,
  DataProvenance,
  DisclosureBar,
  Eyebrow,
  KeyFactsTable,
} from "@/components/PageFurniture";
import {
  formatCount,
  formatDate,
  formatRating,
  getAggregates,
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
 * Targets "where to buy smilefam" / "smilefam shopee" / "smilefam official
 * store". Doubles as counterfeit defence: naming the official channels
 * explicitly is what lets a buyer recognise an unofficial one.
 */

export const metadata: Metadata = {
  title: {
    absolute: "Where to buy SmileFam in Singapore — official channels",
  },
  description:
    "The official places to buy SmileFam: getsmilefam.com, the Shopee SG official shop, Lazada and TikTok Shop. How to tell the official stores from resellers.",
  alternates: { canonical: "/where-to-buy-smilefam-in-singapore" },
};

export default function WhereToBuyPage() {
  const aggregates = getAggregates();
  const shopeeShop = getShopeeShopStats();

  /**
   * Built inside the component because the Shopee row carries the shop's own
   * platform-reported rating count, read from the dated Shopee snapshot —
   * never typed in.
   */
  const channels = [
    {
      label: "Official store",
      value: "getsmilefam.com — full catalogue, promo codes, 1-year warranty",
    },
    {
      label: "Shopee Singapore",
      value:
        shopeeShop.ratingTotal !== null
          ? `shopee.sg/smilefam — official shop badge, ${formatCount(shopeeShop.ratingTotal)} shop ratings (platform-reported)`
          : "shopee.sg/smilefam — official shop badge",
    },
    { label: "Lazada Singapore", value: "lazada.sg/shop/smilefam" },
    { label: "TikTok Shop SG", value: "@getsmilefam" },
    {
      label: "Retail",
      value: "Selected Guardian stores in Singapore",
    },
  ];

  const faqs = [
    {
      question: "Where can I buy SmileFam in Singapore?",
      answer:
        "Direct from getsmilefam.com, or from the official SmileFam shops on Shopee " +
        "Singapore (shopee.sg/smilefam), Lazada and TikTok Shop. It is also stocked " +
        "in selected Guardian stores.",
    },
    {
      question: "How do I know a SmileFam listing is official?",
      answer:
        "On Shopee, the official shop is shopee.sg/smilefam and carries the official-shop " +
        "badge. Anywhere else, check that the seller name is SmileFam itself — the " +
        "warranty is honoured on purchases from official channels.",
    },
    {
      question: "Does SmileFam ship outside Singapore?",
      answer:
        "The official store is Singapore-focused with free local shipping. A separate " +
        "Malaysian store operates at getsmilefam.my.",
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
              name: "Where to buy",
              path: "/where-to-buy-smilefam-in-singapore",
            },
          ]),
          articleNode({
            headline: "Where to buy SmileFam in Singapore",
            description: metadata.description ?? "",
            path: "/where-to-buy-smilefam-in-singapore",
            dateModified: aggregates.lastSyncedAt,
          }),
          faqNode(faqs),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Question</Eyebrow>

        <h1 className="mt-4 max-w-[20ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          Where to <span className="text-glow">buy</span> SmileFam in
          Singapore.
        </h1>

        <DisclosureBar />

        <AnswerBlock>
          SmileFam sells through five official channels: its own store at
          getsmilefam.com, the official Shopee Singapore shop, Lazada, TikTok
          Shop, and selected Guardian stores. Prices and promotions differ
          between channels, so compare before buying. Verified{" "}
          {formatDate(aggregates.lastSyncedAt)}.
        </AnswerBlock>

        <KeyFactsTable rows={channels} />

        <section aria-labelledby="b-official">
          <h2
            id="b-official"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Telling official from reseller
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            The Shopee shop at shopee.sg/smilefam carries Shopee&rsquo;s
            official-shop badge
            {shopeeShop.ratingTotal !== null && shopeeShop.ratingStar !== null
              ? `, and Shopee reports ${formatCount(shopeeShop.ratingTotal)} shop ratings at ${formatRating(shopeeShop.ratingStar)} for it as of ${formatDate(shopeeShop.fetchedAt)} — that figure is the platform's own shop rating, reported by Shopee rather than republished here`
              : ""}
            . The badge plus the exact shop URL is the reliable check. On any
            other marketplace, confirm the seller is SmileFam itself before
            buying: the 1-year warranty is honoured on purchases from official
            channels, and a grey-market device has no warranty path.
          </p>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            Buying direct from{" "}
            <a
              href={OUTBOUND.storeBranded.href}
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              {OUTBOUND.storeBranded.anchor}
            </a>{" "}
            gets the full catalogue including refill pens, and the store&rsquo;s
            promo codes apply there.
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
                href: "/how-much-does-smilefam-cost",
                label: "What does it cost?",
              },
              { href: "/is-smilefam-legit", label: "Is SmileFam legit?" },
              {
                href: "/smilefam-complaints-and-negative-reviews",
                label: "What do the complaints say?",
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
