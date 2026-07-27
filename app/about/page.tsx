import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/JsonLd";
import {
  AnswerBlock,
  DataProvenance,
  Eyebrow,
  KeyFactsTable,
} from "@/components/PageFurniture";
import { formatDate, getAggregates } from "@/lib/data";
import { OUTBOUND } from "@/lib/outbound-links";
import {
  articleNode,
  breadcrumbNode,
  graph,
  publisherNode,
  websiteNode,
} from "@/lib/schema";

/**
 * Full ownership disclosure. The one-line version sits under every H1; this is
 * the long form, and the page the JSON-LD `publishingPrinciples` implicitly
 * pairs with. Anonymous brand-owned review sites are the worst-case E-E-A-T
 * configuration — this page is the antidote.
 */

export const metadata: Metadata = {
  title: "About this site — who runs smilefamreviews.com and why",
  description:
    "smilefamreviews.com is operated by SmileFam Pte Ltd. Why the brand runs its own review archive, and what keeps it honest.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  const aggregates = getAggregates();

  return (
    <>
      <JsonLd
        data={graph(
          publisherNode(),
          websiteNode(aggregates),
          breadcrumbNode([
            { name: "SmileFam Reviews", path: "/" },
            { name: "About", path: "/about" },
          ]),
          articleNode({
            headline: "About smilefamreviews.com",
            description: metadata.description ?? "",
            path: "/about",
            dateModified: aggregates.lastSyncedAt,
          }),
        )}
      />

      <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
        <Eyebrow>About</Eyebrow>

        <h1 className="mt-4 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
          Who runs this site, and <span className="text-glow">why</span>.
        </h1>

        <AnswerBlock>
          smilefamreviews.com is operated by SmileFam Pte Ltd, the Singapore
          company whose products are reviewed here. It exists because
          SmileFam&rsquo;s reviews were scattered across three platforms with no
          single place to read them — including the critical ones. Updated{" "}
          {formatDate(aggregates.lastSyncedAt)}.
        </AnswerBlock>

        <KeyFactsTable
          rows={[
            { label: "Operator", value: "SmileFam Pte Ltd" },
            { label: "UEN", value: "202316423M" },
            {
              label: "Address",
              value: "102F Pasir Panjang Road #08-10, Singapore 118530",
            },
            { label: "Contact", value: "info@getsmilefam.com" },
            {
              label: "The store itself",
              value: (
                <a
                  href={OUTBOUND.storeNaked.href}
                  rel="me"
                  className="underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
                >
                  {OUTBOUND.storeNaked.anchor}
                </a>
              ),
            },
          ]}
        />

        <section aria-labelledby="a-why">
          <h2
            id="a-why"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            Why would a brand publish its own bad reviews?
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            Because the alternative convinces no one. A wall of five-star
            quotes on a brand&rsquo;s own site persuades almost nobody, and
            buyers know it. The bet behind this
            site is simple: SmileFam&rsquo;s real record — including the
            complaints — is strong enough that showing all of it works better
            than curating it.
          </p>
          <p className="prose-measure mt-4 leading-relaxed font-light text-navy">
            That bet only pays if the site is actually complete, which is why
            every count is computed from the collected data, why negative
            reviews are{" "}
            <Link
              href="/reviews/critical"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              published in full
            </Link>
            , and why{" "}
            <Link
              href="/methodology"
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 hover:decoration-navy"
            >
              the collection method
            </Link>{" "}
            — filters, gaps and all — is documented.
          </p>
        </section>

        <section aria-labelledby="a-independence">
          <h2
            id="a-independence"
            className="mt-14 font-display text-2xl font-extrabold tracking-tight text-navy"
          >
            What this site is not
          </h2>
          <p className="prose-measure mt-3 leading-relaxed font-light text-navy">
            It is not independent, and it does not claim to be. It is a
            brand-operated archive of reviews that mostly live on platforms the
            brand cannot edit. If you want a fully independent read, follow any
            review&rsquo;s source link to Google or Facebook and read it
            there — that is exactly what those links are for.
          </p>
        </section>

        <DataProvenance aggregates={aggregates} />
      </main>
    </>
  );
}
