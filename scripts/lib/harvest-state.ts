import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  latestSnapshotFor,
  readJsonIfExists,
  readSnapshotMeta,
  writeJsonAtomic,
} from "./snapshot";

/**
 * data/harvest-state.json — the pipeline's memory between runs.
 *
 * Snapshot meta files record what ONE harvest returned; this file records where
 * each SOURCE currently stands: when it last ran, what it covered, and the
 * newest review date seen. The refresh orchestrator reads it to decide which
 * paid harvests are due, and `google.ts --incremental` reads `newestReviewDate`
 * to size and date-bound its run.
 *
 * `newestReviewDate` is the max REVIEW date in the returned set, never the
 * harvest time — a harvest that returns three-month-old reviews must not
 * convince the next incremental run that the last three months are covered.
 */

const STATE_PATH = path.join("data", "harvest-state.json");

export const SourceStateSchema = z.object({
  /** When the harvester last ran (its harvestedAt). */
  lastHarvestedAt: z.iso.datetime(),
  lastSnapshotPath: z.string().min(1),
  lastCoverage: z.enum(["full", "incremental"]),
  /** Last run whose coverage was "full" — the tombstoning baseline. */
  lastFullHarvestAt: z.iso.datetime().nullable(),
  /** Rows in the last snapshot (raw rows, pre any publish filter). */
  itemCount: z.int().nonnegative(),
  /** Max review date in the last returned set. NOT the harvest time. */
  newestReviewDate: z.iso.datetime().nullable(),
  /**
   * Shopee only: the shop's ratingTotal at the last PAID harvest. The free
   * change gate compares a fresh fetch against this — see shopee.ts.
   */
  shopeeRatingTotal: z.number().nullable().optional(),
  /**
   * Google only: cached probe result, so a full run soon after a probe (or an
   * incremental run) doesn't pay for a redundant one.
   */
  probe: z
    .object({
      probedAt: z.iso.datetime(),
      reviewsCount: z.int().nonnegative().nullable(),
      totalScore: z.number().nullable(),
    })
    .optional(),
  /** Stamped only: the publish-filter setting in force at the last harvest. */
  stampedPhotoOnly: z.boolean().optional(),
});
export type SourceState = z.infer<typeof SourceStateSchema>;

export const HarvestStateSchema = z.object({
  version: z.literal(1),
  sources: z.record(z.string(), SourceStateSchema),
});
export type HarvestState = z.infer<typeof HarvestStateSchema>;

export function loadHarvestState(): HarvestState {
  const raw = readJsonIfExists<unknown>(STATE_PATH);
  if (!raw) return { version: 1, sources: {} };
  return HarvestStateSchema.parse(raw);
}

export function saveHarvestState(state: HarvestState): void {
  writeJsonAtomic(STATE_PATH, HarvestStateSchema.parse(state));
}

/**
 * Merge-update one source's entry. Called by every harvester immediately after
 * writeSnapshot, so the state file can never describe a snapshot that was not
 * actually written.
 */
export function recordHarvest(
  source: string,
  entry: Partial<SourceState> & {
    lastHarvestedAt: string;
    lastSnapshotPath: string;
    lastCoverage: "full" | "incremental";
    itemCount: number;
    newestReviewDate: string | null;
  },
): void {
  const state = loadHarvestState();
  const prior = state.sources[source];
  // newestReviewDate may only move forward: a quiet incremental run that
  // returned nothing must not erase the date the next incremental gates on.
  const newestReviewDate =
    [prior?.newestReviewDate, entry.newestReviewDate]
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  state.sources[source] = SourceStateSchema.parse({
    ...prior,
    ...entry,
    newestReviewDate,
    lastFullHarvestAt:
      entry.lastCoverage === "full"
        ? entry.lastHarvestedAt
        : (entry.lastFullHarvestAt ?? prior?.lastFullHarvestAt ?? null),
  });
  saveHarvestState(state);
}

/** Update only the cached Google probe result. Free-standing so a probe-only
 * run (which writes no snapshot) can still be remembered. */
export function recordProbe(probe: {
  probedAt: string;
  reviewsCount: number | null;
  totalScore: number | null;
}): void {
  const state = loadHarvestState();
  const prior = state.sources.google;
  if (prior) {
    state.sources.google = { ...prior, probe };
    saveHarvestState(state);
    return;
  }
  // No google harvest yet — nothing sensible to invent for the required
  // fields, so the probe cache waits until the first real harvest.
}

/**
 * One-off derivation: build the state file from what is already on disk — the
 * committed snapshot metas plus data/reviews.json for per-source newest review
 * dates. Used to seed data/harvest-state.json for a pipeline that predates it;
 * a no-op when the file already exists.
 */
export function seedHarvestStateFromDisk(): HarvestState | null {
  if (fs.existsSync(STATE_PATH)) return null;

  const reviews =
    readJsonIfExists<Array<{ source: string; date: string }>>(
      path.join("data", "reviews.json"),
    ) ?? [];
  const newestBySource = new Map<string, string>();
  for (const r of reviews) {
    const prev = newestBySource.get(r.source);
    if (!prev || r.date > prev) newestBySource.set(r.source, r.date);
  }

  const state: HarvestState = { version: 1, sources: {} };
  for (const source of ["stamped", "google", "shopee", "facebook"]) {
    const snapshot = latestSnapshotFor(source);
    if (!snapshot) continue;
    const meta = readSnapshotMeta(snapshot);
    state.sources[source] = SourceStateSchema.parse({
      lastHarvestedAt: meta.harvestedAt,
      lastSnapshotPath: snapshot,
      lastCoverage: meta.coverage,
      lastFullHarvestAt: meta.coverage === "full" ? meta.harvestedAt : null,
      itemCount: meta.itemCount,
      newestReviewDate: newestBySource.get(source) ?? null,
    });
  }

  saveHarvestState(state);
  return state;
}
