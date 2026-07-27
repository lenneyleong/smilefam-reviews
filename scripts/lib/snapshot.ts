import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Raw harvest snapshots.
 *
 * These are COMMITTED, gzipped. The reason is specific: this Apify account's
 * `dataRetentionDays` is 31, so if we relied on Apify to hold the raw data, the
 * evidence backing every displayed review would evaporate within a month. A
 * review site that cannot prove its reviews came from somewhere is exactly the
 * failure mode that shut down a sibling brand.
 *
 * ~300-600 KB per snapshot, a handful per year. Cheap insurance.
 */

export const RAW_DIR = path.join("data", "raw");

export type SnapshotCoverage = "full" | "incremental";

export interface SnapshotMeta {
  source: string;
  coverage: SnapshotCoverage;
  itemCount: number;
  harvestedAt: string;
  adapterVersion: string;
  apifyRunId: string | null;
  /** Real spend for this run, straight from Apify's usage figure. */
  costUsd: number | null;
  /** What the platform claims it holds, when it tells us. Never displayed as our own count. */
  platformReportedCount: number | null;
  platformReportedAverage: number | null;
  notes?: string;
}

/** Timestamped directory name, e.g. "2026-07-27T2145Z". Filesystem-safe. */
export function makeSnapshotId(now: Date): string {
  return now.toISOString().replace(/:/g, "").replace(/\.\d+Z$/, "Z");
}

export function snapshotDir(snapshotId: string): string {
  return path.join(RAW_DIR, snapshotId);
}

export function writeSnapshot<T>(input: {
  snapshotId: string;
  source: string;
  items: T[];
  meta: Omit<SnapshotMeta, "itemCount" | "source">;
}): { dataPath: string; metaPath: string; sha256: string } {
  const dir = snapshotDir(input.snapshotId);
  fs.mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(input.items);
  const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });

  const dataPath = path.join(dir, `${input.source}.json.gz`);
  const metaPath = path.join(dir, `${input.source}.meta.json`);

  fs.writeFileSync(dataPath, gz);

  const meta: SnapshotMeta = {
    ...input.meta,
    source: input.source,
    itemCount: input.items.length,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  return {
    dataPath,
    metaPath,
    sha256: createHash("sha256").update(gz).digest("hex"),
  };
}

export function readSnapshot<T>(snapshotPath: string): T[] {
  const gz = fs.readFileSync(snapshotPath);
  return JSON.parse(gunzipSync(gz).toString("utf8")) as T[];
}

export function readSnapshotMeta(snapshotPath: string): SnapshotMeta {
  const metaPath = snapshotPath.replace(/\.json\.gz$/, ".meta.json");
  return JSON.parse(fs.readFileSync(metaPath, "utf8")) as SnapshotMeta;
}

/** Newest snapshot file for a source, or null if none has been taken yet. */
export function latestSnapshotFor(source: string): string | null {
  if (!fs.existsSync(RAW_DIR)) return null;

  const candidates = fs
    .readdirSync(RAW_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(RAW_DIR, e.name, `${source}.json.gz`))
    .filter((p) => fs.existsSync(p))
    .sort();

  return candidates[candidates.length - 1] ?? null;
}

/**
 * Write JSON atomically — temp file then rename. A harvest that dies partway
 * through must never leave data/reviews.json truncated, because the site builds
 * from it and a half-written corpus would silently drop reviews.
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
