import { z } from "zod";

import type { Review, ReviewSource } from "./schema";
import { normalizeForContentKey, sha256, toDayString } from "./text";

/**
 * Identity key. Per-source and authoritative — two records with the same
 * dedupeKey are the same review seen on two different harvest runs.
 */
export function makeDedupeKey(source: ReviewSource, sourceId: string): string {
  return sha256(`${source}|${sourceId}`);
}

/**
 * Content fingerprint, used to DETECT cross-posting, never to merge it.
 *
 * If the same customer left the same words on Google and on Shopee, those are
 * two independently verifiable artifacts. Collapsing them would quietly delete
 * a row from the audit trail, so instead we count them separately and expose
 * `uniqueContentCount` alongside the raw total — that way the headline number
 * holds up whichever way a skeptic wants to count.
 */
export function makeContentKey(input: {
  authorDisplay: string;
  rating: number | null;
  dateIso: string;
  body: string;
}): string {
  return sha256(
    [
      input.authorDisplay.toLowerCase().trim(),
      input.rating ?? "n",
      toDayString(input.dateIso),
      normalizeForContentKey(input.body),
    ].join("|"),
  );
}

/**
 * Merge a freshly harvested batch into the existing corpus.
 *
 * Preserves `firstSeenOn` (when we first saw a review) and carries forward
 * already-rehosted photo paths, so re-running the harvest never re-downloads
 * images or resets history.
 */
export function mergeReviews(existing: Review[], incoming: Review[]): Review[] {
  const byKey = new Map<string, Review>(existing.map((r) => [r.dedupeKey, r]));

  for (const next of incoming) {
    const prior = byKey.get(next.dedupeKey);
    if (!prior) {
      byKey.set(next.dedupeKey, next);
      continue;
    }

    // Keep the local image work already done for this review's photos.
    //
    // Keyed on remoteUrl, NOT sha256: a freshly harvested photo carries only a
    // placeholder hash derived from its filename, while scripts/images.ts
    // replaces that with the hash of the real downloaded bytes. Matching on
    // sha256 therefore never hits, and every re-normalize would silently throw
    // away the downloaded, EXIF-stripped, optimized images. remoteUrl is the
    // one identifier stable across both stages.
    const priorPhotosByUrl = new Map(
      prior.photos
        .filter((p) => p.remoteUrl !== null)
        .map((p) => [p.remoteUrl!, p]),
    );
    const photos = next.photos.map((p) => {
      const before = p.remoteUrl ? priorPhotosByUrl.get(p.remoteUrl) : undefined;
      return before?.rehosted ? { ...p, ...before } : p;
    });

    // Machine translations are paid work done AFTER harvest, so a re-harvest
    // of the same review arrives untranslated. Without carrying the cached
    // translation forward, every re-normalize would silently revert the body
    // to the source language and queue a re-translation.
    // Guard: only reuse the cache while the upstream text is unchanged — the
    // fresh harvest's `body` is the untranslated original, so it must equal
    // the original we translated. An edited review gets re-translated.
    const translation =
      prior.translationSource === "machine-cached" &&
      prior.bodyOriginal === next.body
        ? {
            body: prior.body,
            bodyOriginal: prior.bodyOriginal,
            bodyLanguage: prior.bodyLanguage,
            translated: prior.translated,
            translationSource: prior.translationSource,
          }
        : null;

    byKey.set(next.dedupeKey, {
      ...next,
      ...(translation ?? {}),
      photos,
      firstSeenOn: prior.firstSeenOn,
      status: "active",
    });
  }

  return sortDeterministically([...byKey.values()]);
}

/**
 * Newest first, with source and id as tiebreakers so an unchanged re-run
 * produces a zero-line git diff. That silence is the signal: when the diff is
 * non-empty, something genuinely changed upstream.
 */
export function sortDeterministically(reviews: Review[]): Review[] {
  return [...reviews].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      a.source.localeCompare(b.source) ||
      a.sourceId.localeCompare(b.sourceId),
  );
}

/**
 * Tombstoning guard.
 *
 * Only a FULL harvest may mark reviews as removed, and even then we refuse if
 * the run came back with implausibly little data. A blocked scraper or a
 * platform outage must never silently wipe 500 reviews off the site.
 */
export const MIN_FULL_RUN_COVERAGE = 0.7;

export function canTombstone(input: {
  coverage: "full" | "incremental";
  returnedCount: number;
  knownCount: number;
}): { ok: boolean; reason?: string } {
  if (input.coverage !== "full") {
    return { ok: false, reason: "incremental run — tombstoning not permitted" };
  }
  if (input.knownCount === 0) return { ok: true };

  const ratio = input.returnedCount / input.knownCount;
  if (ratio < MIN_FULL_RUN_COVERAGE) {
    return {
      ok: false,
      reason:
        `run returned ${input.returnedCount} of ${input.knownCount} known reviews ` +
        `(${(ratio * 100).toFixed(1)}%, floor is ${MIN_FULL_RUN_COVERAGE * 100}%) — ` +
        `refusing to tombstone; this looks like a blocked scrape, not deletions`,
    };
  }
  return { ok: true };
}

/**
 * Mark reviews of `source` that a FULL harvest no longer returned as removed.
 *
 * Guarded by canTombstone(): only a full-coverage run with plausible volume may
 * do this. `removedOn` comes from the harvest date, not wall-clock time, so a
 * re-run of normalize over the same snapshots is byte-identical.
 *
 * Returns the (possibly) updated list plus what happened, so the caller can
 * log the refusal reason instead of silently doing nothing.
 */
export function applyTombstones(input: {
  reviews: Review[];
  source: ReviewSource;
  coverage: "full" | "incremental";
  /** dedupeKeys present in the incoming (fresh) set for this source. */
  incomingKeys: Set<string>;
  /** Incoming records for this source, counted post publish-filtering. */
  returnedCount: number;
  /** Previously-known ACTIVE records of this source, pre-merge. */
  knownCount: number;
  /** "YYYY-MM-DD", derived from the snapshot's harvestedAt. */
  removedOn: string;
}): { reviews: Review[]; tombstoned: number; refusal: string | null } {
  const decision = canTombstone({
    coverage: input.coverage,
    returnedCount: input.returnedCount,
    knownCount: input.knownCount,
  });
  if (!decision.ok) {
    return { reviews: input.reviews, tombstoned: 0, refusal: decision.reason ?? null };
  }

  let tombstoned = 0;
  const updated = input.reviews.map((review) => {
    if (
      review.source !== input.source ||
      review.status !== "active" ||
      input.incomingKeys.has(review.dedupeKey)
    ) {
      return review;
    }
    tombstoned += 1;
    return { ...review, status: "removed" as const, removedOn: input.removedOn };
  });

  return { reviews: updated, tombstoned, refusal: null };
}

/**
 * data/suppressions.json — the manual PDPA-removal path /methodology promises.
 *
 * An entry here removes the review from every public surface regardless of
 * whether the platform still returns it on harvest. The record itself stays in
 * the corpus (status "removed") and its snapshot stays on disk, so provenance
 * remains verifiable; only display and aggregates exclude it.
 */
export const SuppressionSchema = z.object({
  /** The review's dedupeKey — sha256(`${source}|${sourceId}`). */
  dedupeKey: z.string().length(64),
  /** Why it was suppressed, e.g. "PDPA removal request from reviewer". */
  reason: z.string().min(1),
  /** "YYYY-MM-DD" — when the suppression was granted. Becomes removedOn. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type Suppression = z.infer<typeof SuppressionSchema>;

export const SuppressionsFileSchema = z.array(SuppressionSchema);

/** Applied LAST in normalize, so a fresh harvest can never revive a suppressed
 * review — merge flips reappearing records to active, this flips them back. */
export function applySuppressions(
  reviews: Review[],
  suppressions: Suppression[],
): { reviews: Review[]; suppressed: number; unmatched: Suppression[] } {
  if (suppressions.length === 0) {
    return { reviews, suppressed: 0, unmatched: [] };
  }

  const byKey = new Map(suppressions.map((s) => [s.dedupeKey, s]));
  const matched = new Set<string>();
  let suppressed = 0;

  const updated = reviews.map((review) => {
    const hit = byKey.get(review.dedupeKey);
    if (!hit) return review;
    matched.add(hit.dedupeKey);
    if (review.status === "removed" && review.removedOn === hit.date) {
      return review;
    }
    suppressed += 1;
    return { ...review, status: "removed" as const, removedOn: hit.date };
  });

  const unmatched = suppressions.filter((s) => !matched.has(s.dedupeKey));
  return { reviews: updated, suppressed, unmatched };
}
