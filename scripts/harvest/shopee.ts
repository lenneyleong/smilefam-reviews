import "../env";

import { z } from "zod";

import path from "node:path";

import { runActor, updateLedgerSnapshot } from "../apify";
import { recordHarvest } from "../lib/harvest-state";
import { makeSnapshotId, writeJsonAtomic, writeSnapshot } from "../lib/snapshot";
import {
  assertShopeeConfigured,
  SHOPEE_PRODUCTS,
} from "./shopee.config";
import {
  fetchShopeeShopStats,
  loadShopeeShopStats,
  shopeeGateBaseline,
  shopeeHasChanged,
} from "./shopee-shop-stats";

/**
 * Shopee SG reviews via zen-studio/shopee-product-reviews-scraper.
 *
 * Shopee is the site's only meaningful source of non-five-star evidence: the
 * shop carries 498 good / 9 normal / 1 bad, while all 417 Stamped reviews are
 * 5.0. Without those 10 the site would be a wall of perfect scores, which
 * neither a skeptical buyer nor an LLM finds credible.
 *
 * The free `get_shop_detail` endpoint gates this run. If the rating totals are
 * unchanged since the last harvest, we skip and spend $0 instead of ~$1.94.
 */

const ADAPTER_VERSION = "shopee@1";

export const ShopeeReviewSchema = z
  .object({
    // Field names come from the actor's README, which ships no sample record —
    // passthrough keeps anything unexpected so the snapshot stays complete and
    // the adapter can be corrected without re-paying for the scrape.
    itemId: z.union([z.string(), z.number()]).nullish(),
    shopId: z.union([z.string(), z.number()]).nullish(),
    orderId: z.union([z.string(), z.number()]).nullish(),
    cmtId: z.union([z.string(), z.number()]).nullish(),
    ratingStar: z.number().nullish(),
    comment: z.string().nullish(),
    author: z.string().nullish(),
    authorUsername: z.string().nullish(),
    ctime: z.union([z.string(), z.number()]).nullish(),
    images: z.array(z.string()).nullish(),
    productName: z.string().nullish(),
    modelName: z.string().nullish(),
  })
  .passthrough();

export type ShopeeReview = z.infer<typeof ShopeeReviewSchema>;

function readFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const full = args.includes("--full");
  const yesSpend = readFlag(args, "--yes-spend");

  assertShopeeConfigured();

  // Free change-detection gate. Skipping here is the difference between a
  // $0.001 refresh and a $1.94 one.
  //
  // This harvester owns fetch-and-compare: the baseline is the rating total at
  // the last PAID harvest (harvest-state), NOT whatever the stats file was
  // last refreshed to — comparing a fresh fetch against a freshly refreshed
  // file is the bug that made this gate permanently read "unchanged".
  const previousStats = loadShopeeShopStats();
  const current = await fetchShopeeShopStats();
  const baseline = shopeeGateBaseline();
  const changed = shopeeHasChanged(baseline, current);

  if (!changed && !force) {
    console.log(
      `Shopee rating total unchanged at ${current.ratingTotal} ` +
        `(baseline ${baseline} from the last paid harvest) — skipping the paid scrape.\n` +
        `Use --force to run anyway.`,
    );
    return;
  }

  // Persist the fresh stats now that the gate has been evaluated, keeping the
  // previous total so the stats file's own fallback baseline stays meaningful.
  writeJsonAtomic(path.join("data", "shopee-shop-stats.json"), {
    ...current,
    previousRatingTotal: previousStats?.ratingTotal ?? null,
  });

  const maxReviewsPerProduct = full ? 0 : 60;
  const expectedResults = full
    ? (current.ratingTotal ?? 508)
    : maxReviewsPerProduct * SHOPEE_PRODUCTS.length;

  const harvestedAt = new Date().toISOString();
  const snapshotId = makeSnapshotId(new Date(harvestedAt));

  const { items, runId, usageTotalUsd } = await runActor<unknown, ShopeeReview>({
    actorKey: "shopee",
    label: full ? "shopee full" : "shopee incremental",
    expectedResults,
    yesSpendUsd: yesSpend,
    input: {
      startUrls: SHOPEE_PRODUCTS.map((p) => ({ url: p.url })),
      maxReviewsPerProduct,
      // We pay per review returned, and rating-only entries carry no text worth
      // publishing — the shop-level counts already come free from get_shop_detail.
      contentFilter: full ? "all" : "with comments",
    },
    timeoutMs: 45 * 60_000,
  });

  const parsed = items.map((raw) => ShopeeReviewSchema.parse(raw));
  const distribution = parsed.reduce<Record<string, number>>((acc, r) => {
    const key = String(r.ratingStar ?? "?");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const { dataPath } = writeSnapshot({
    snapshotId,
    source: "shopee",
    items: parsed,
    meta: {
      coverage: full ? "full" : "incremental",
      harvestedAt,
      adapterVersion: ADAPTER_VERSION,
      apifyRunId: runId,
      costUsd: usageTotalUsd,
      platformReportedCount: current.ratingTotal,
      platformReportedAverage: current.ratingStar,
      notes:
        `Shop reports ${current.ratingGood} good / ${current.ratingNormal} normal / ` +
        `${current.ratingBad} bad (total ${current.ratingTotal}, avg ${current.ratingStar}). ` +
        `Returned distribution: ${JSON.stringify(distribution)}.`,
    },
  });

  // Record the paid-harvest baseline: the NEXT run's gate compares a fresh
  // fetch against this ratingTotal. Also link the ledger entry to its snapshot.
  updateLedgerSnapshot(runId, dataPath);
  recordHarvest("shopee", {
    lastHarvestedAt: harvestedAt,
    lastSnapshotPath: dataPath,
    lastCoverage: full ? "full" : "incremental",
    itemCount: parsed.length,
    newestReviewDate:
      parsed
        .map((r) => {
          if (r.ctime === null || r.ctime === undefined) return null;
          const n = Number(r.ctime);
          const d = Number.isFinite(n)
            ? new Date(n < 10_000_000_000 ? n * 1000 : n)
            : new Date(String(r.ctime));
          return Number.isNaN(d.getTime()) ? null : d.toISOString();
        })
        .filter((d): d is string => d !== null)
        .sort()
        .at(-1) ?? null,
    shopeeRatingTotal: current.ratingTotal,
  });

  console.log(`\n  harvested:    ${parsed.length}`);
  console.log(`  distribution: ${JSON.stringify(distribution)}`);
  console.log(`  snapshot:     ${dataPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
