import Link from "next/link";

import { formatCount, formatDate, formatRating } from "@/lib/data";
import { OUTBOUND } from "@/lib/outbound-links";
import type { Aggregates } from "@/lib/reviews/aggregate";
import { SOURCE_LABELS } from "@/lib/reviews/schema";

/**
 * Ownership disclosure, directly under the H1 on every page.
 *
 * Not in the footer. The relationship between this domain and SmileFam is
 * discoverable via WHOIS in about ten seconds, so concealing it buys nothing
 * and costs everything if noticed — an undisclosed brand-owned review site is a
 * doorway, while a disclosed one is a legitimate page type. It also changes how
 * an AI assistant frames a citation: "according to the brand's own review hub"
 * beats being dropped as astroturf.
 */
export function DisclosureBar() {
  // Per Lenney (2026-07-28): no "How we collect reviews" link here. The
  // ownership disclosure itself stays — it is what keeps a brand-owned review
  // domain a declared archive rather than an undisclosed doorway, and
  // /methodology remains reachable from the header nav and footer.
  return (
    <p className="mt-6 border-l-2 border-mist py-1 pl-4 text-sm leading-relaxed font-light text-navy-soft">
      smilefamreviews.com is operated by SmileFam. We republish customer reviews
      collected from Google, Facebook and the SmileFam store.
    </p>
  );
}

/**
 * The 40–60 word direct answer, first element after the H1.
 *
 * Written to be liftable verbatim by an AI assistant: verdict first, then the
 * strongest number, then a qualifier, then the date. The qualifier is not
 * hedging — an answer with no caveat reads as marketing and gets discounted by
 * both search raters and retrieval heuristics. It is what makes the block
 * citable.
 */
export function AnswerBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 border-t-2 border-navy pt-6">
      <p className="prose-measure text-lg leading-relaxed text-navy">
        {children}
      </p>
    </div>
  );
}

/**
 * Dense, liftable fact table. This is the highest citation-value-per-byte
 * element on any answer page — retrieval systems quote tables close to verbatim.
 */
export function KeyFactsTable({
  rows,
}: {
  rows: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="my-10 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[0.95rem]">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-mist">
              <th
                scope="row"
                className="w-[14rem] py-3 pr-6 align-top font-medium text-navy-soft"
              >
                {row.label}
              </th>
              <td className="py-3 align-top text-navy">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Per-source counts plus the sync timestamp, in the footer of every page that
 * states a number. Repetitive by design — it means any drift between a page's
 * claims and the underlying data is visible on that same page.
 */
export function DataProvenance({ aggregates }: { aggregates: Aggregates }) {
  const sources = Object.entries(aggregates.bySource)
    .filter(([, stats]) => stats.harvestedCount > 0)
    .map(
      ([source, stats]) =>
        `${(SOURCE_LABELS as Record<string, string>)[source] ?? source} ${formatCount(stats.harvestedCount)}`,
    );

  return (
    <footer className="mt-20 border-t border-mist pt-6 text-sm font-light text-navy-soft">
      <p>
        {formatCount(aggregates.totals.reviewCount)} reviews ·{" "}
        {formatRating(aggregates.weightedAverage.value)} average across{" "}
        {formatCount(aggregates.weightedAverage.n)} rated reviews ·{" "}
        {sources.join(" · ")}
      </p>
      <p className="mt-1">
        Last updated{" "}
        <time dateTime={aggregates.lastSyncedAt}>
          {formatDate(aggregates.lastSyncedAt)}
        </time>
        . {aggregates.weightedAverage.basis}
      </p>
    </footer>
  );
}

/** Eyebrow label. Used sparingly — it labels, it does not decorate. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs tracking-label text-navy-soft uppercase">{children}</p>
  );
}

const NAV = [
  { href: "/reviews", label: "All reviews" },
  { href: "/reviews/critical", label: "Critical" },
  { href: "/photos", label: "Photos" },
  { href: "/methodology", label: "How we collect" },
] as const;

export function SiteHeader() {
  return (
    <header className="border-b border-mist">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-xs focus:bg-navy focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-4xl flex-wrap items-baseline justify-between gap-4 px-6 py-5">
        <Link
          href="/"
          className="wordmark text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
        >
          SmileFam
        </Link>
        <nav aria-label="Main">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-light text-navy-soft">
            {NAV.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-silver focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <div className="mt-24 border-t border-mist">
      <div className="mx-auto max-w-4xl px-6 py-10 text-sm font-light text-navy-soft">
        <p>
          Operated by SmileFam Pte Ltd (UEN 202316423M), 102F Pasir Panjang Road
          #08-10, Singapore 118530.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
          <li>
            <Link href="/methodology" className="underline decoration-mist underline-offset-4 hover:decoration-navy-soft">
              How we collect reviews
            </Link>
          </li>
          <li>
            <Link href="/about" className="underline decoration-mist underline-offset-4 hover:decoration-navy-soft">
              About this site
            </Link>
          </li>
          <li>
            <a
              href={OUTBOUND.footerStore.href}
              rel="me"
              className="underline decoration-mist underline-offset-4 hover:decoration-navy-soft"
            >
              {OUTBOUND.footerStore.anchor}
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
