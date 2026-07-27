import "./env";

import fs from "node:fs";
import path from "node:path";

import { ApifyError, getLimits, lifetimeSpendUsd } from "./apify";
import { estimateRunCostUsd } from "./apify-pricing";
import { run as runAggregate } from "./aggregate";
import { run as runImages } from "./images";
import { run as runNormalize } from "./normalize";
import { run as runVerify } from "./verify";
import { run as runShopeeStats } from "./harvest/shopee-shop-stats";
import {
  fetchShopeeShopStats,
  shopeeGateBaseline,
  shopeeHasChanged,
} from "./harvest/shopee-shop-stats";
import { SHOPEE_PRODUCTS } from "./harvest/shopee.config";
import { run as runProducts } from "./harvest/shopify-products";
import { run as runStamped } from "./harvest/stamped";
import {
  loadHarvestState,
  seedHarvestStateFromDisk,
} from "./lib/harvest-state";

/**
 * The refresh orchestrator: one command that runs every stage in the only
 * order that is correct.
 *
 *   preflight → free harvests → paid-harvest PLAN → normalize → images →
 *   aggregate → verify → summary
 *
 * Two rules it exists to enforce:
 *
 *   1. IT NEVER SPENDS MONEY. The paid harvesters (google/shopee/facebook)
 *      are printed as a plan — which would run, why, what it should cost —
 *      and the operator runs them explicitly. A refresh you can run without
 *      thinking must be a refresh that cannot bill anything.
 *
 *   2. Derived data is always rebuilt in full, in order. Running aggregate
 *      before normalize (or forgetting verify) is how aggregates.json's
 *      reviewsSha256 goes stale; putting the whole chain behind one command
 *      makes that class of mistake impossible.
 *
 * Fail closed: the first stage error aborts everything after it.
 *
 * Flags:
 *   --dry-run          describe every stage, execute nothing that writes
 *   --sources=a,b,c    limit harvest stages to these sources
 *                      (stamped|google|shopee|facebook|products)
 */

const REVIEWS_PATH = path.join("data", "reviews.json");

/** Paid-harvest cadence. Google's listing gains ~1.55 reviews/day, so
 * fortnightly incrementals keep pace; Facebook moves far slower. */
const GOOGLE_INTERVAL_DAYS = 14;
const FACEBOOK_INTERVAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_SOURCES = ["products", "stamped", "google", "shopee", "facebook"] as const;
type SourceToken = (typeof ALL_SOURCES)[number];

interface Options {
  dryRun: boolean;
  sources: Set<SourceToken>;
}

function parseArgs(argv: string[]): Options {
  const dryRun = argv.includes("--dry-run");
  const sourcesArg = argv.find((a) => a.startsWith("--sources="));
  let sources = new Set<SourceToken>(ALL_SOURCES);
  if (sourcesArg) {
    const requested = sourcesArg
      .slice("--sources=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = requested.filter(
      (s) => !ALL_SOURCES.includes(s as SourceToken),
    );
    if (invalid.length > 0) {
      throw new Error(
        `unknown --sources value(s): ${invalid.join(", ")} ` +
          `(valid: ${ALL_SOURCES.join(", ")})`,
      );
    }
    sources = new Set(requested as SourceToken[]);
  }
  return { dryRun, sources };
}

function daysSince(iso: string | undefined | null): number | null {
  if (!iso) return null;
  return (Date.now() - Date.parse(iso)) / DAY_MS;
}

function fmtDays(days: number | null): string {
  return days === null ? "never" : `${days.toFixed(1)}d ago`;
}

async function stage<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  console.log(`\n━━ ${name} ${"━".repeat(Math.max(1, 60 - name.length))}`);
  try {
    return await fn();
  } catch (error) {
    console.error(`\n✗ stage "${name}" failed — aborting the refresh.`);
    throw error;
  }
}

function activeReviewCount(): number {
  const raw = fs.existsSync(REVIEWS_PATH)
    ? (JSON.parse(fs.readFileSync(REVIEWS_PATH, "utf8")) as Array<{
        status: string;
      }>)
    : [];
  return raw.filter((r) => r.status === "active").length;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const statuses = new Map<string, string>();

  console.log(
    `SmileFam reviews refresh${options.dryRun ? " (DRY RUN — nothing will be written)" : ""}`,
  );

  // Seed harvest-state from committed snapshots if this workspace predates it.
  const seeded = seedHarvestStateFromDisk();
  if (seeded) {
    console.log("  seeded data/harvest-state.json from existing snapshots");
  }

  const reviewsBefore = activeReviewCount();
  const spendBefore = lifetimeSpendUsd();

  // ---------------------------------------------------------- 1. preflight
  let apifyAvailable = false;
  await stage("preflight — Apify headroom", async () => {
    try {
      const limits = await getLimits();
      apifyAvailable = true;
      console.log(`  cap:      $${limits.capUsd.toFixed(2)}`);
      console.log(`  spent:    $${limits.usedUsd.toFixed(4)} this cycle`);
      console.log(`  headroom: $${limits.headroomUsd.toFixed(4)}`);
      console.log(`  cycle ends: ${limits.cycleEndsAt ?? "unknown"}`);
    } catch (error) {
      // No key / API down is NOT fatal: the free pipeline still works. The
      // paid-harvest plan below just cannot promise headroom.
      const message =
        error instanceof ApifyError ? error.message.split("\n")[0] : String(error);
      console.warn(`  ⚠ could not read Apify limits: ${message}`);
      console.warn("  continuing with FREE stages only.");
    }
  });

  // -------------------------------------------------------- 2. free stages
  await stage("free harvests", async () => {
    const runs: Array<[SourceToken, string, () => Promise<void>]> = [
      ["products", "shopify product map", runProducts],
      ["shopee", "shopee shop stats (free gate input)", runShopeeStats],
      ["stamped", "stamped first-party reviews", runStamped],
    ];
    for (const [token, label, fn] of runs) {
      if (!options.sources.has(token)) {
        statuses.set(label, "skipped (--sources)");
        console.log(`  ∅ ${label}: skipped by --sources`);
        continue;
      }
      if (options.dryRun) {
        statuses.set(label, "dry-run (would run)");
        console.log(`  ▷ [dry-run] would run: ${label}`);
        continue;
      }
      console.log(`  ▶ ${label}`);
      await fn();
      statuses.set(label, "ran");
    }
  });

  // ------------------------------------------------- 3. paid harvest PLAN
  await stage("paid harvests — PLAN ONLY, never executed here", async () => {
    const state = loadHarvestState();

    if (options.sources.has("google")) {
      const google = state.sources.google;
      const since = daysSince(google?.lastHarvestedAt);
      const due = since === null || since >= GOOGLE_INTERVAL_DAYS;
      const mode = google?.newestReviewDate ? "--incremental" : "(full)";
      const fullSize = Math.ceil((google?.probe?.reviewsCount ?? 1500) * 1.1);
      const est =
        mode === "--incremental"
          ? estimateRunCostUsd("google", 50)
          : estimateRunCostUsd("google", fullSize);
      statuses.set("google (paid)", due ? "DUE — run manually" : "not due");
      console.log(
        `  google:   last harvest ${fmtDays(since)} (interval ${GOOGLE_INTERVAL_DAYS}d) → ` +
          (due ? "DUE" : "not due"),
      );
      if (due) {
        console.log(
          `            run: npm run harvest:google -- ${mode}   (≈$${est.toFixed(4)})`,
        );
      }
    }

    if (options.sources.has("shopee")) {
      if (SHOPEE_PRODUCTS.length === 0) {
        statuses.set("shopee (paid)", "blocked — product URLs not configured");
        console.log(
          "  shopee:   BLOCKED — no product URLs in scripts/harvest/shopee.config.ts",
        );
      } else {
        try {
          const current = await fetchShopeeShopStats(); // free endpoint
          const baseline = shopeeGateBaseline();
          const due = shopeeHasChanged(baseline, current);
          statuses.set("shopee (paid)", due ? "DUE — run manually" : "not due");
          console.log(
            `  shopee:   rating total ${current.ratingTotal} vs baseline ` +
              `${baseline ?? "none (never paid-harvested)"} → ${due ? "DUE" : "not due"}`,
          );
          if (due) {
            const est = estimateRunCostUsd("shopee", current.ratingTotal ?? 508);
            console.log(
              `            run: npm run harvest:shopee   (≈$${est.toFixed(4)} full)`,
            );
          }
        } catch (error) {
          statuses.set("shopee (paid)", "gate unreadable");
          console.warn(
            `  shopee:   ⚠ free gate endpoint unreachable (${(error as Error).message.slice(0, 80)})`,
          );
        }
      }
    }

    if (options.sources.has("facebook")) {
      const facebook = state.sources.facebook;
      const since = daysSince(facebook?.lastHarvestedAt);
      const due = since === null || since >= FACEBOOK_INTERVAL_DAYS;
      statuses.set("facebook (paid)", due ? "DUE — run manually" : "not due");
      console.log(
        `  facebook: last harvest ${fmtDays(since)} (interval ${FACEBOOK_INTERVAL_DAYS}d) → ` +
          (due ? "DUE" : "not due"),
      );
      if (due) {
        console.log(
          `            run: npm run harvest:facebook   (≈$${estimateRunCostUsd("facebook", 200).toFixed(4)})`,
        );
      }
    }

    if (!apifyAvailable) {
      console.log(
        "  note: APIFY_API_KEY unavailable — the commands above will refuse to run until it is set.",
      );
    }
    console.log(
      "\n  This orchestrator never spends. Run the DUE commands yourself, then `npm run refresh` again.",
    );
  });

  // ------------------------------------------- 4. derived data, in order
  const derived: Array<[string, () => Promise<void>]> = [
    ["normalize", runNormalize],
    ["images", runImages],
    ["aggregate", runAggregate],
    ["verify", runVerify],
  ];
  for (const [name, fn] of derived) {
    await stage(name, async () => {
      if (options.dryRun) {
        console.log(`  ▷ [dry-run] would run: ${name}`);
        statuses.set(name, "dry-run (would run)");
        return;
      }
      await fn();
      statuses.set(name, "ran");
    });
  }

  // ------------------------------------------------------------ 5. summary
  await stage("summary", async () => {
    const reviewsAfter = activeReviewCount();
    const delta = reviewsAfter - reviewsBefore;
    const spendAfter = lifetimeSpendUsd();

    console.log(
      `  active reviews: ${reviewsBefore} → ${reviewsAfter} (${delta >= 0 ? "+" : ""}${delta})`,
    );
    console.log(
      `  spend this refresh: $${(spendAfter - spendBefore).toFixed(4)} ` +
        `(lifetime ledger $${spendAfter.toFixed(4)})`,
    );
    console.log("  per-stage status:");
    for (const [name, status] of statuses) {
      console.log(`    ${name.padEnd(38)} ${status}`);
    }
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
