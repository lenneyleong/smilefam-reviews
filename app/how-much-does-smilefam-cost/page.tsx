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
import {
  formatDate,
  getAggregates,
  getProducts,
  getProductsFetchedAt,
} from "@/lib/data";
import { productLink } from "@/lib/outbound-links";
import {
  articleNode,
  breadcrumbNode,
  faqNode,
  graph,
  publisherNode,
  websiteNode,
} from "@/lib/schema";

/**
 * Targets "smilefam price" / "smilefam price singapore".
 *
 * Every price on this page is HARVESTED from the store's own products.json and
 * date-stamped — never typed in. When the store changes a price, the next data
 * sync changes this page. The date-stamp is what lets an AI assistant cite a
 * price without asserting it as timeless.
 */

/** Products a buyer actually searches for, in the order they ask. */
const FEATURED_HANDLES = [
  "blu-teeth-whitening-kit",
  "smilefam-bundle-kit",
  "blu-whitening-toothpaste",
  "whiteningpen",
  "smilefam-refiller-pack-contains-2-refillers",
];

/**
 * Product names as this site refers to them. The store's catalogue titles are
 * marketing headlines ("Whiter Teeth, Better Smile and Korean Beauty in Just
 * 15 Minutes!") — rendering those raw would read as this site's own copy.
 * Prices still come exclusively from the harvested catalogue.
 */
const DISPLAY_NAMES: Record<string, string> = {
  "blu-teeth-whitening-kit": "BLU Teeth Whitening Kit",
  "smilefam-bundle-kit": "Whitening Electric Toothbrush Bundle",
  "blu-whitening-toothpaste": "BLU Whitening Toothpaste",
  whiteningpen: "Snow Serum Whitening Pen",
  "smilefam-refiller-pack-contains-2-refillers": "Refiller Pack (2 refillers)",
};

export const metadata: Metadata = {
  title: { absolute: "SmileFam prices in Singapore — current, dated" },
  description:
    "Current SmileFam prices in SGD, pulled from the official store and date-stamped: BLU Whitening Kit, Electric Toothbrush bundle, toothpaste, pen and refills.",
  alternates: { canonical: "/how-much-does-smilefam-cost" },
};

export default function PricePage() {
  const aggregates = getAggregates();
  const products = getProducts();

  const featured = FEATURED_HANDLES.map((handle) =>
    products.find((product) => product.handle === handle),
  ).filter((product): product is NonNullable<typeof product> => Boolean(product));

  const kit = featured.find((product) => product.handle === "blu-teeth-whitening-kit");
  // The date the PRICES were pulled from the store — deliberately not the
  // review sync date, which moves on every review harvest.
  const syncedOn = formatDate(getProductsFetchedAt());

  const faqs = [
    {
      question: "How much is the SmileFam BLU Whitening Kit?",
      answer: kit
        ? `S$${kit.priceSgd} on the official store, last checked ${syncedOn}. Promo codes are often active, so the checkout price can be lower.`
        : `See the current price on the official store — prices change and this page only reports what was live when last checked on ${syncedOn}.`,
    },
    {
      question: "Is SmileFam cheaper than dentist whitening in Singapore?",
      answer:
        "Usually, yes — but we do not hold clinic pricing data, so we will not " +
        "quote a figure. In-clinic whitening in Singapore is a per-treatment cost " +
        "typically well above a home kit; check a clinic's published price list. " +
        "The SmileFam kit is a one-time purchase with refillable pens; the " +
        "trade-off is that a dentist treatment is professionally supervised and " +
        "typically stronger.",
    },
    {
      question: "Where are SmileFam's prices lowest?",
      answer:
        "The official store, Shopee and Lazada run different promotions at " +
        "different times. Compare the three before buying — all are official " +
        "channels for the same products.",
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
            { name: "SmileFam prices", path: "/how-much-does-smilefam-cost" },
          ]),
          articleNode({
            headline: "How much does SmileFam cost in Singapore?",
            description: metadata.description ?? "",
            path: "/how-much-does-smilefam-cost",
            dateModified: aggregates.lastSyncedAt,
          }),
          faqNode(faqs),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>Question</Eyebrow>

        <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          How much does SmileFam <span className="text-glow">cost</span>?
        </h1>

        <DisclosureBar />

        <AnswerBlock>
          {kit
            ? `The BLU Whitening Kit is S$${kit.priceSgd} on the official store, last checked ${syncedOn}.`
            : `Prices below were last checked on ${syncedOn}.`}{" "}
          Prices below are pulled directly from the store&rsquo;s catalogue and
          re-checked on every data sync — treat them as a dated snapshot, and
          check the store before buying, since promo codes are often active.
        </AnswerBlock>

        <section aria-labelledby="p-table">
          <h2
            id="p-table"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Current prices, last checked {syncedOn}
          </h2>
          <div className="my-6 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left text-[0.95rem]">
              <caption className="sr-only">
                SmileFam product prices in Singapore dollars, harvested from the
                official store.
              </caption>
              <thead>
                <tr className="border-b border-mist text-xs tracking-label text-navy-soft uppercase">
                  <th scope="col" className="py-3 pr-4 font-medium">
                    Product
                  </th>
                  <th scope="col" className="py-3 text-right font-medium">
                    Price (SGD)
                  </th>
                </tr>
              </thead>
              <tbody>
                {featured.map((product) => {
                  const link = productLink(product.handle, product.title);
                  const displayName =
                    DISPLAY_NAMES[product.handle] ?? product.title;
                  return (
                    <tr key={product.handle} className="border-b border-mist/70">
                      <th scope="row" className="py-3.5 pr-4 font-medium text-navy">
                        {link ? (
                          <a
                            href={link.href}
                            className="underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
                          >
                            {displayName}
                          </a>
                        ) : (
                          displayName
                        )}
                      </th>
                      <td className="py-3.5 text-right tabular-nums">
                        {product.priceSgd ? `S$${product.priceSgd}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="prose-measure leading-relaxed font-light text-navy-soft">
            Prices last checked {syncedOn}, from the store&rsquo;s public
            catalogue. Promotions and bundle pricing change frequently and are
            not reflected here.
          </p>
        </section>

        <section aria-labelledby="p-context">
          <h2
            id="p-context"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Is that expensive for what it is?
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            In-clinic whitening in Singapore is a per-treatment cost typically
            well above a home kit — we do not hold clinic pricing data, so
            check a clinic&rsquo;s published price list rather than a figure
            here. Against other home kits, SmileFam sits at
            the premium end of the local market. What reviewers weigh against
            the price: the 1-year warranty, local support, and refill pens
            that don&rsquo;t require rebuying the device. One critical reviewer
            calls it an overpriced OEM device — that review is published in full
            on the complaints page, and the price table above lets you judge the
            value question yourself.
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
                href: "/where-to-buy-smilefam-in-singapore",
                label: "Where do I buy it?",
              },
              {
                href: "/does-smilefam-actually-work",
                label: "Does it actually work?",
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
