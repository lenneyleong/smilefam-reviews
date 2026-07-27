/**
 * Stamped ingestion policy. Pattern matches shopee.config.ts: the knobs a human
 * flips live in a config file, not buried inside the harvester.
 *
 * Lenney's call (2026-07-27): ingest only reviews that carry customer photos.
 *
 * Trade-off, recorded so it can be revisited with eyes open: this drops 281
 * text reviews, and the loss is concentrated on the flagship — BLU Kit goes
 * from 64 reviews to 9. Flip to false to ingest the full published set.
 *
 * The flag's current value is recorded in data/harvest-state.json on every
 * stamped harvest (NOT in the snapshot meta — the snapshot is evidence of what
 * the platform served, not of our display policy).
 */
export const STAMPED_PHOTO_ONLY = true;

/**
 * The single photo predicate, used by BOTH scripts/harvest/stamped.ts and
 * scripts/normalize.ts. It was previously duplicated in each, which is exactly
 * how the published subset and the snapshot bookkeeping drift apart.
 *
 * Stamped's `reviewUserPhotos` is a comma-separated string of filenames,
 * absent/null/"" when the review has none.
 */
export function hasPhotos(raw: { reviewUserPhotos?: string | null }): boolean {
  return Boolean(raw.reviewUserPhotos);
}
