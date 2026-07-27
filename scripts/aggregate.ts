import "./env";

import fs from "node:fs";
import path from "node:path";

import {
  computeAggregates,
  type PlatformReported,
} from "../lib/reviews/aggregate";
import { ReviewsFileSchema } from "../lib/reviews/schema";
import { sha256 } from "../lib/reviews/text";
import { loadShopeeShopStats } from "./harvest/shopee-shop-stats";
import {
  latestSnapshotFor,
  readSnapshotMeta,
  writeJsonAtomic,
} from "./lib/snapshot";

/**
 * Produce data/aggregates.json — the only place the site is allowed to get a
 * number from.
 *
 * The important discipline here is the separation between what WE hold
 * (`harvestedCount`) and what a platform CLAIMS it holds
 * (`platformReportedCount`). The first is the only thing that ever becomes a
 * headline; the second can only ever appear as an attributed secondary stat.
 * That split is what keeps the arithmetic on the page addable by a skeptic.
 */

const REVIEWS_PATH = path.join("data", "reviews.json");
const OUT = path.join("data", "aggregates.json");

function collectPlatformReported(): PlatformReported {
  const reported: PlatformReported = {};

  for (const source of ["stamped", "google", "shopee", "facebook"] as const) {
    const snapshot = latestSnapshotFor(source);
    if (!snapshot) continue;
    const meta = readSnapshotMeta(snapshot);
    if (meta.platformReportedCount === null && meta.platformReportedAverage === null) {
      continue;
    }
    reported[source] = {
      count: meta.platformReportedCount,
      average: meta.platformReportedAverage,
    };
  }

  // Shopee's shop-detail endpoint is free and more current than any scrape,
  // so it wins over whatever the last paid run happened to report.
  const shopee = loadShopeeShopStats();
  if (shopee) {
    reported.shopee = {
      count: shopee.ratingTotal,
      average: shopee.ratingStar,
    };
  }

  return reported;
}

/** The freshest harvest across all sources — drives every `dateModified`. */
function resolveLastSyncedAt(): string {
  const times: string[] = [];
  for (const source of ["stamped", "google", "shopee", "facebook"] as const) {
    const snapshot = latestSnapshotFor(source);
    if (snapshot) times.push(readSnapshotMeta(snapshot).harvestedAt);
  }
  return times.sort().at(-1) ?? new Date().toISOString();
}

export async function run(): Promise<void> {
  const rawFile = fs.readFileSync(REVIEWS_PATH, "utf8");
  const reviews = ReviewsFileSchema.parse(JSON.parse(rawFile));

  const aggregates = computeAggregates({
    reviews,
    reviewsSha256: sha256(rawFile),
    generatedAt: new Date().toISOString(),
    lastSyncedAt: resolveLastSyncedAt(),
    platformReported: collectPlatformReported(),
  });

  writeJsonAtomic(OUT, aggregates);

  const { totals, weightedAverage, bySource, byProduct } = aggregates;
  console.log("Aggregates\n");
  console.log(`  reviews held:       ${totals.reviewCount}`);
  console.log(`  rated:              ${totals.ratedReviewCount}`);
  console.log(`  recommendations:    ${totals.recommendationCount}`);
  console.log(`  with photos:        ${totals.withPhotoCount} (${totals.photoCount} photos)`);
  console.log(`  verified buyers:    ${totals.verifiedBuyerCount}`);
  console.log(`  unique content:     ${totals.uniqueContentCount}`);
  console.log(
    `  weighted average:   ${weightedAverage.value ?? "n/a"} over ${weightedAverage.n}`,
  );

  console.log("\n  by source:");
  for (const [source, stats] of Object.entries(bySource)) {
    if (stats.harvestedCount === 0 && stats.platformReportedCount === null) continue;
    const claimed =
      stats.platformReportedCount === null
        ? ""
        : `  (platform claims ${stats.platformReportedCount}` +
          `${stats.discrepancy === null ? "" : `, gap ${stats.discrepancy}`})`;
    console.log(
      `    ${source.padEnd(9)} held ${String(stats.harvestedCount).padStart(4)}` +
        `  avg ${stats.average ?? "n/a"}${claimed}`,
    );
  }

  console.log("\n  by product:");
  for (const product of byProduct) {
    console.log(
      `    ${String(product.count).padStart(4)}  ` +
        `${product.showAverage ? `avg ${product.average}` : "avg suppressed"}  ` +
        `${product.name}`,
    );
  }
  console.log(`\n  → ${OUT}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
