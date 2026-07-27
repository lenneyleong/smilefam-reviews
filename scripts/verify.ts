import "./env";

import fs from "node:fs";
import path from "node:path";

import { AggregatesSchema } from "../lib/reviews/aggregate";
import { ReviewsFileSchema, type Review } from "../lib/reviews/schema";
import { sha256 } from "../lib/reviews/text";
import { hasPhotos, STAMPED_PHOTO_ONLY } from "./harvest/stamped.config";
import { latestSnapshotFor, RAW_DIR, readSnapshot } from "./lib/snapshot";

/**
 * The integrity gate. Runs before every build.
 *
 * Two independent checks, both of which exist because of the same history: a
 * sibling brand was publicly called out over fabricated testimonials and had to
 * shut down. A review site is only worth building if its claims survive someone
 * actually checking them.
 *
 *   1. PROVENANCE — every displayed review's body must hash to the bytes in a
 *      committed raw snapshot. You cannot hand-write a review into
 *      data/reviews.json and have it survive this.
 *
 *   2. NO HARDCODED NUMBERS — no review count or rating may be typed into a
 *      component. Every number must flow from data/aggregates.json, so the
 *      arithmetic on the page always adds up.
 */

const REVIEWS_PATH = path.join("data", "reviews.json");
const AGGREGATES_PATH = path.join("data", "aggregates.json");
const SCAN_DIRS = ["app", "components"];

interface Failure {
  check: string;
  detail: string;
}

// ------------------------------------------------------------- provenance

/** Pull the body text out of a raw record, per source adapter. */
function rawBodyFor(source: Review["source"], raw: unknown): string | null {
  const row = raw as Record<string, unknown>;
  switch (source) {
    case "stamped":
      return typeof row.reviewMessage === "string" ? row.reviewMessage : null;
    case "google":
      return typeof row.textTranslated === "string" && row.textTranslated
        ? row.textTranslated
        : typeof row.text === "string"
          ? row.text
          : null;
    case "shopee":
      return typeof row.comment === "string" ? row.comment : null;
    case "facebook":
      return typeof row.text === "string" ? row.text : null;
  }
}

function verifyProvenance(reviews: Review[]): Failure[] {
  const failures: Failure[] = [];
  const snapshotCache = new Map<string, unknown[]>();

  for (const review of reviews) {
    const { snapshot, rawIndex, bodySha256 } = review.provenance;

    if (!fs.existsSync(snapshot)) {
      failures.push({
        check: "provenance",
        detail: `${review.id}: snapshot missing on disk — ${snapshot}`,
      });
      continue;
    }

    let rows = snapshotCache.get(snapshot);
    if (!rows) {
      rows = readSnapshot<unknown>(snapshot);
      snapshotCache.set(snapshot, rows);
    }

    const raw = rows[rawIndex];
    if (raw === undefined) {
      failures.push({
        check: "provenance",
        detail: `${review.id}: rawIndex ${rawIndex} out of range in ${snapshot}`,
      });
      continue;
    }

    const rawBody = rawBodyFor(review.source, raw);
    if (rawBody === null) {
      failures.push({
        check: "provenance",
        detail: `${review.id}: no body field found in raw record`,
      });
      continue;
    }

    // Compare against the trimmed body — that is exactly what the adapters hash.
    const expected = rawBody.trim();
    if (sha256(expected) !== bodySha256) {
      failures.push({
        check: "provenance",
        detail:
          `${review.id}: recorded hash does not match its raw snapshot record.`,
      });
      continue;
    }

    // The check that actually protects the reader: the text the SITE DISPLAYS
    // must equal the harvested text. Without this, someone could edit `body`
    // in reviews.json, leave `provenance` untouched, and sail through — which
    // is precisely what an earlier version of this script allowed.
    //
    // One legitimate divergence: machine-cached translations. There the
    // displayed `body` is OUR translation and the harvested text lives in
    // `bodyOriginal` — so that is the field held to the snapshot instead.
    const mustMatchSnapshot =
      review.translationSource === "machine-cached"
        ? review.bodyOriginal
        : review.body;
    if (mustMatchSnapshot !== expected) {
      failures.push({
        check: "provenance",
        detail:
          `${review.id}: displayed body differs from the harvested text. ` +
          `This review has been altered after harvest.`,
      });
    }
  }

  return failures;
}

/**
 * Referential integrity between the corpus and data/raw/.
 *
 * Today every referenced snapshot exists (the per-review check above would
 * catch a miss anyway) — this guards FUTURE pruning: deleting a raw dir that
 * any review still points at must fail the build, and a dir no review points
 * at any more is worth a warning before someone assumes it is load-bearing.
 */
function verifySnapshotReferences(reviews: Review[]): {
  failures: Failure[];
  warnings: string[];
} {
  const failures: Failure[] = [];
  const warnings: string[] = [];

  const referencedDirs = new Set(
    reviews.map((r) => path.dirname(r.provenance.snapshot)),
  );

  for (const dir of referencedDirs) {
    if (!fs.existsSync(dir)) {
      failures.push({
        check: "snapshot-refs",
        detail: `snapshot dir referenced by reviews is missing on disk: ${dir}`,
      });
    }
  }

  if (fs.existsSync(RAW_DIR)) {
    for (const entry of fs.readdirSync(RAW_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "photos") continue; // gitignored originals cache
      const dir = path.join(RAW_DIR, entry.name);
      if (!referencedDirs.has(dir)) {
        warnings.push(
          `raw snapshot dir referenced by zero reviews: ${dir} ` +
            `(safe to prune once its evidence value has been weighed)`,
        );
      }
    }
  }

  return { failures, warnings };
}

/**
 * The publish policy must actually hold: with STAMPED_PHOTO_ONLY on, the
 * records ingested from the newest stamped snapshot must number exactly the
 * photo-carrying rows in it. Counted via provenance.snapshot so records
 * tombstoned from older snapshots don't muddy the comparison.
 */
function verifyStampedPublishPolicy(reviews: Review[]): Failure[] {
  if (!STAMPED_PHOTO_ONLY) return [];
  const snapshot = latestSnapshotFor("stamped");
  if (!snapshot) return [];

  const photoRows = readSnapshot<Record<string, unknown>>(snapshot).filter(
    (row) => hasPhotos(row),
  ).length;
  const published = reviews.filter(
    (r) => r.source === "stamped" && r.provenance.snapshot === snapshot,
  ).length;

  if (published !== photoRows) {
    return [
      {
        check: "stamped-policy",
        detail:
          `STAMPED_PHOTO_ONLY is on, but ${published} stamped records were ` +
          `ingested from ${snapshot} versus ${photoRows} photo-carrying rows ` +
          `in it. The photo filter and the corpus have drifted apart — ` +
          `re-run \`npm run normalize\`.`,
      },
    ];
  }
  return [];
}

// -------------------------------------------------------- hardcoded numbers

/**
 * Numerals that must never be typed into a component: review counts, star
 * averages, the marketing claims. If one of these appears literally in JSX, it
 * has bypassed aggregates.json and will silently go stale.
 */
const FORBIDDEN = [
  // Counts: up to two words may sit between the numeral and the unit, so
  // "1,691 written Google reviews" and "500 happy customers" are both caught,
  // not just the adjacent form.
  /\b\d{2,5}(?:,\d{3})?\+?(?:\s+\w+){0,2}\s+(?:reviews?|ratings?|customers?|Singaporeans)\b/i,
  // Ratings: "4.8/5", "4.92 stars", "4.9★", "4.8 — rated", "4.8 out of 5".
  /\b[45]\.\d{1,2}\s*(?:\/\s*5|stars?|★|—|out of)/i,
  /\b(?:1,600|13,000|10,000|1,691|1,500)\b/,
];

function scanForHardcodedNumbers(): Failure[] {
  const failures: Failure[] = [];

  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!/\.(tsx?|jsx?|mdx?)$/.test(file)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");

      lines.forEach((line, i) => {
        // An explicit opt-out for the rare legitimate literal (a phone number,
        // a year). Must be justified in the comment, which makes it reviewable.
        if (line.includes("verify-ignore")) return;

        for (const pattern of FORBIDDEN) {
          if (pattern.test(line)) {
            failures.push({
              check: "hardcoded-number",
              detail:
                `${file}:${i + 1} — "${line.trim().slice(0, 90)}"\n` +
                `      Read this from data/aggregates.json instead.`,
            });
            break;
          }
        }
      });
    }
  }

  return failures;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// ------------------------------------------------------------- consistency

function verifyAggregatesMatch(reviews: Review[]): Failure[] {
  if (!fs.existsSync(AGGREGATES_PATH)) return [];

  const aggregates = AggregatesSchema.parse(
    JSON.parse(fs.readFileSync(AGGREGATES_PATH, "utf8")),
  );
  const rawFile = fs.readFileSync(REVIEWS_PATH, "utf8");
  const failures: Failure[] = [];

  if (aggregates.reviewsSha256 !== sha256(rawFile)) {
    failures.push({
      check: "staleness",
      detail:
        "data/aggregates.json was computed from a different data/reviews.json. " +
        "Run `npm run aggregate`.",
    });
  }

  const active = reviews.filter((r) => r.status === "active").length;
  if (aggregates.totals.reviewCount !== active) {
    failures.push({
      check: "staleness",
      detail:
        `aggregates say ${aggregates.totals.reviewCount} reviews, corpus has ${active} active.`,
    });
  }

  // Per-source counts must sum to the headline. This is precisely the sum a
  // skeptical reader will do on /data, so the build should do it first.
  const summed = Object.values(aggregates.bySource).reduce(
    (n, s) => n + s.harvestedCount,
    0,
  );
  if (summed !== aggregates.totals.reviewCount) {
    failures.push({
      check: "arithmetic",
      detail:
        `per-source counts sum to ${summed} but the headline total is ` +
        `${aggregates.totals.reviewCount}. These must match exactly.`,
    });
  }

  return failures;
}

// -------------------------------------------------------------------- main

export async function run(): Promise<void> {
  if (!fs.existsSync(REVIEWS_PATH)) {
    console.log("No data/reviews.json yet — nothing to verify.");
    return;
  }

  // Removed reviews are verified too, on purpose: their snapshots stay on
  // disk, so a tombstoned or suppressed record must still trace to its bytes.
  const reviews = ReviewsFileSchema.parse(
    JSON.parse(fs.readFileSync(REVIEWS_PATH, "utf8")),
  );

  const snapshotRefs = verifySnapshotReferences(reviews);
  const failures = [
    ...verifyProvenance(reviews),
    ...snapshotRefs.failures,
    ...verifyStampedPublishPolicy(reviews),
    ...verifyAggregatesMatch(reviews),
    ...scanForHardcodedNumbers(),
  ];

  const byCheck = failures.reduce<Record<string, number>>((acc, f) => {
    acc[f.check] = (acc[f.check] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Verifying ${reviews.length} reviews\n`);
  console.log(`  provenance:       ${byCheck.provenance ?? 0} failures`);
  console.log(`  snapshot refs:    ${byCheck["snapshot-refs"] ?? 0} failures`);
  console.log(`  stamped policy:   ${byCheck["stamped-policy"] ?? 0} failures`);
  console.log(`  aggregate match:  ${(byCheck.staleness ?? 0) + (byCheck.arithmetic ?? 0)} failures`);
  console.log(`  hardcoded numbers:${byCheck["hardcoded-number"] ?? 0} failures`);

  for (const warning of snapshotRefs.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }

  if (failures.length === 0) {
    console.log("\n✓ every review traces to committed harvested bytes");
    console.log("✓ every displayed number comes from aggregates.json");
    return;
  }

  console.error(`\n✗ ${failures.length} failures\n`);
  for (const failure of failures.slice(0, 40)) {
    console.error(`  [${failure.check}] ${failure.detail}`);
  }
  if (failures.length > 40) {
    console.error(`  … and ${failures.length - 40} more`);
  }
  // Throw rather than process.exit so the refresh orchestrator can fail
  // closed on this stage; the CLI guard below still exits non-zero.
  throw new Error(`verify: ${failures.length} failure(s)`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
