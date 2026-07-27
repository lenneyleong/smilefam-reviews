import { formatCount, formatRating } from "@/lib/data";
import type { Aggregates } from "@/lib/reviews/aggregate";
import { SOURCE_LABELS, SOURCE_LISTING_URLS } from "@/lib/reviews/schema";

/**
 * Where every review came from, with the arithmetic laid out.
 *
 * The rule line and explicit total are the point: the first thing a skeptical
 * reader does is add the per-source counts and check they reach the headline.
 * The build enforces the same sum (scripts/verify.ts), so the page can invite
 * that check rather than hope nobody does it.
 *
 * The "we hold / platform says" split is equally deliberate. Google's listing
 * reports more reviews than we can display, because some carry a star rating
 * with no written text. Showing both numbers is more honest than picking
 * whichever is larger, and it pre-empts the obvious "your count doesn't match
 * Google" objection.
 */

const ORDER = ["google", "shopee", "stamped", "facebook"] as const;

export function SourceLedger({ aggregates }: { aggregates: Aggregates }) {
  // A source with platform-reported figures but zero held reviews (Shopee
  // today) still gets a row — "0 held / 508 reported" is more honest than
  // silently hiding it, and /methodology's prose refers to exactly that row.
  const rows = ORDER.map((source) => ({
    source,
    stats: aggregates.bySource[source],
  })).filter(
    (row) =>
      row.stats &&
      (row.stats.harvestedCount > 0 || row.stats.platformReportedCount !== null),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[0.95rem]">
        <caption className="sr-only">
          Reviews held per source, with the count each platform reports.
        </caption>
        <thead>
          <tr className="border-b border-mist text-xs tracking-label text-navy-soft uppercase">
            <th scope="col" className="py-3 pr-4 font-medium">
              Source
            </th>
            <th scope="col" className="py-3 pr-4 text-right font-medium">
              We hold
            </th>
            <th scope="col" className="py-3 pr-4 text-right font-medium">
              Rating
            </th>
            <th scope="col" className="py-3 text-right font-medium">
              Platform reports
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map(({ source, stats }) => {
            const listing = SOURCE_LISTING_URLS[source];
            return (
              <tr key={source} className="border-b border-mist/70">
                <th scope="row" className="py-3.5 pr-4 font-medium text-navy">
                  {listing ? (
                    <a
                      href={listing}
                      rel="noopener"
                      className="underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      {SOURCE_LABELS[source]}
                    </a>
                  ) : (
                    SOURCE_LABELS[source]
                  )}
                </th>
                <td className="py-3.5 pr-4 text-right tabular-nums">
                  {formatCount(stats!.harvestedCount)}
                </td>
                <td className="py-3.5 pr-4 text-right tabular-nums text-navy-soft">
                  {formatRating(stats!.average)}
                </td>
                <td className="py-3.5 text-right tabular-nums text-navy-soft">
                  {stats!.platformReportedCount === null
                    ? "—"
                    : formatCount(stats!.platformReportedCount)}
                </td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-navy">
            <th scope="row" className="py-3.5 pr-4 font-extrabold text-navy">
              Total
            </th>
            <td className="py-3.5 pr-4 text-right font-extrabold tabular-nums text-navy">
              {formatCount(aggregates.totals.reviewCount)}
            </td>
            <td className="py-3.5 pr-4 text-right font-extrabold tabular-nums text-navy">
              {formatRating(aggregates.weightedAverage.value)}
            </td>
            <td className="py-3.5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
