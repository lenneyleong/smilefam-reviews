import { ImageResponse } from "next/og";

import { formatCount, formatRating, getAggregates } from "@/lib/data";

/**
 * Site-wide Open Graph card, generated at build time from the live aggregates
 * so the numbers on the share card can never drift from the numbers on the
 * page. Runs in the Node runtime — the server-only data module is fine here.
 */

export const alt =
  "SmileFam Reviews — every review, including the bad ones";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#002351";
const NAVY_SOFT = "#1b3a66";

export default function OpengraphImage() {
  const aggregates = getAggregates();
  // Single pre-built string: Satori treats interleaved JSX text segments as
  // separate child nodes and then demands explicit display:flex.
  const statsLine =
    `${formatCount(aggregates.totals.reviewCount)} customer reviews · ` +
    `${formatRating(aggregates.weightedAverage.value)} average across ` +
    `${formatCount(aggregates.weightedAverage.n)} rated`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "72px 80px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "0.3em",
            color: NAVY,
          }}
        >
          S M I L E F A M
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: NAVY,
              maxWidth: 980,
            }}
          >
            Every review, including the bad ones.
          </div>
          <div
            style={{
              marginTop: 32,
              fontSize: 34,
              fontWeight: 400,
              color: NAVY_SOFT,
            }}
          >
            {statsLine}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `2px solid ${NAVY}`,
            paddingTop: 28,
            fontSize: 26,
            color: NAVY_SOFT,
          }}
        >
          <div>smilefamreviews.com</div>
          <div>Sources and dates on every review</div>
        </div>
      </div>
    ),
    size,
  );
}
