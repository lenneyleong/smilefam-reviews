import "./env";

import fs from "node:fs";
import path from "node:path";

import { ReviewsFileSchema } from "../lib/reviews/schema";

/**
 * Translation stub.
 *
 * The full corpus currently contains ZERO non-English bodies: Google hands us
 * `textTranslated` for free (translationSource "platform"), and franc-based
 * detection in scripts/normalize.ts tags everything else "en". Building a paid
 * machine translator for an empty queue would be dead code with an API bill,
 * so this script only DETECTS the need and refuses to pretend otherwise.
 *
 * If non-English bodies ever appear, this exits non-zero with the list — that
 * is the trigger to build the real translator (translationSource
 * "machine-cached"; the merge in lib/reviews/dedupe.ts and the provenance
 * check in scripts/verify.ts already support cached translations surviving
 * re-harvests).
 */

const REVIEWS_PATH = path.join("data", "reviews.json");

export async function run(): Promise<void> {
  if (!fs.existsSync(REVIEWS_PATH)) {
    console.log("No data/reviews.json yet — nothing to translate.");
    return;
  }

  const reviews = ReviewsFileSchema.parse(
    JSON.parse(fs.readFileSync(REVIEWS_PATH, "utf8")),
  );

  // Language detection already ran in normalize (franc). Anything tagged
  // non-English and not already translated by its platform is the queue.
  const pending = reviews.filter(
    (r) =>
      r.status === "active" &&
      r.bodyLanguage !== "en" &&
      r.translationSource === "none",
  );

  if (pending.length === 0) {
    console.log("0 non-English bodies — nothing to translate.");
    return;
  }

  console.error(
    `${pending.length} non-English bodies need translation, but no translator ` +
      `is built (deliberately — the corpus had none when this stub was written):`,
  );
  for (const r of pending.slice(0, 20)) {
    console.error(`  ${r.id} [${r.bodyLanguage}] ${r.body.slice(0, 60)}…`);
  }
  throw new Error(
    `translate: ${pending.length} untranslated non-English bodies. ` +
      `Time to build the real translator.`,
  );
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
