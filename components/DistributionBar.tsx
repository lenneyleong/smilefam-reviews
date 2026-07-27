import { formatCount } from "@/lib/data";

/**
 * The site's signature element.
 *
 * One stacked bar of every rated review. The 5- and 4-star blocks dominate; the
 * handful rated 3 or below is a sliver a few pixels wide — and that sliver is
 * the one that gets a label and a link.
 *
 * Pointing at your own negative reviews in the hero is counterintuitive on a
 * brand-owned property. It is also the one thing a fabricated review site never
 * does, which is exactly why it makes the remaining 1,800 believable to a reader
 * who arrived by searching "is smilefam legit".
 *
 * Deliberately NOT colour-coded red/amber/green. The critical segment renders in
 * Silver — visible and named, but not dramatized. Alarm colours would editorialize
 * a set of reviews we are trying to present plainly.
 */

interface DistributionBarProps {
  distribution: Record<string, number>;
}

const CRITICAL_CEILING = 3;

export function DistributionBar({ distribution }: DistributionBarProps) {
  const five = distribution["5"] ?? 0;
  const four = distribution["4"] ?? 0;
  const critical =
    (distribution["3"] ?? 0) + (distribution["2"] ?? 0) + (distribution["1"] ?? 0);
  const total = five + four + critical;

  if (total === 0) return null;

  const pct = (n: number) => (n / total) * 100;
  // Floor the critical segment's width so it stays clickable at any total —
  // its true share can be a fraction of a percent, under a pixel on mobile.
  const criticalWidth = critical > 0 ? Math.max(pct(critical), 0.9) : 0;
  const remaining = 100 - criticalWidth;
  // The 5- and 4-star segments share whatever the critical floor left over,
  // scaled by their own subtotal so the three segments always sum to 100%.
  const rest = five + four;

  return (
    <figure className="not-prose my-10">
      <div
        className="flex h-11 w-full overflow-hidden rounded-sm bg-mist"
        role="img"
        aria-label={`${formatCount(five)} reviews rated 5 stars, ${formatCount(four)} rated 4 stars, and ${formatCount(critical)} rated ${CRITICAL_CEILING} stars or lower, out of ${formatCount(total)} rated reviews.`}
      >
        <div
          className="bar-segment bg-navy"
          style={{ width: `${rest > 0 ? (five / rest) * remaining : 0}%` }}
        />
        <div
          className="bar-segment bg-navy-soft"
          style={{ width: `${rest > 0 ? (four / rest) * remaining : 0}%` }}
        />
        {critical > 0 && (
          <div
            className="bar-segment bar-critical bg-silver"
            style={{ width: `${criticalWidth}%` }}
          />
        )}
      </div>

      {/*
        Per Lenney (2026-07-28), no legend entry for the critical segment. The
        segment itself stays in the bar and in the aria-label — the chart must
        remain arithmetically honest even without the callout.
      */}
      <figcaption className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm">
        <Legend swatch="bg-navy" label="5 stars" value={five} />
        <Legend swatch="bg-navy-soft" label="4 stars" value={four} />
      </figcaption>
    </figure>
  );
}

function Legend({
  swatch,
  label,
  value,
}: {
  swatch: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-baseline gap-2 text-navy-soft">
      <span
        aria-hidden
        className={`inline-block size-2.5 translate-y-px rounded-xs ${swatch}`}
      />
      <span className="font-medium text-navy">{formatCount(value)}</span>
      <span className="font-light">{label}</span>
    </span>
  );
}
