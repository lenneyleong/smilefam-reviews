import "./env";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import sharp from "sharp";

import { ReviewsFileSchema, type Review } from "../lib/reviews/schema";
import { getBuffer } from "./lib/http";
import { readJsonIfExists, writeJsonAtomic } from "./lib/snapshot";

/**
 * Download, sanitize and optimize customer review photos.
 *
 * Rehost policy — first-party only:
 *   stamped  → YES. Customers uploaded these to SmileFam's own review app.
 *   google   → no (Maps ToS forbids caching; copyright sits with the reviewer)
 *   shopee   → no (platform ToS)
 *   facebook → no (Meta ToS; the actor returns no review photos anyway)
 *   avatars  → NEVER, from any source (PDPA + ToS)
 *
 * Enforced by `displayPolicy.canRehostPhotos`, which only the Stamped adapter
 * sets true. Anything else keeps `rehosted: false` and the render component
 * refuses it.
 *
 * Idempotent: a photo already in the manifest with its output file on disk is
 * skipped, so re-runs cost nothing and never re-download.
 */

const REVIEWS_PATH = path.join("data", "reviews.json");
const MANIFEST_PATH = path.join("data", "photos-manifest.json");
const ORIGINALS_DIR = path.join("data", "raw", "photos"); // gitignored
const OUT_DIR = path.join("public", "reviews", "img");

/** One master per photo. next/image derives responsive variants from it. */
const MAX_WIDTH = 1400;
const WEBP_QUALITY = 78;
const CONCURRENCY = 4;

interface ManifestEntry {
  /** sha256 of the ORIGINAL downloaded bytes — the content address. */
  sha256: string;
  remoteUrl: string;
  originalBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  out: string;
  blurDataUrl: string;
  fetchedAt: string;
}

type Manifest = Record<string, ManifestEntry>;

function loadManifest(): Manifest {
  return readJsonIfExists<Manifest>(MANIFEST_PATH) ?? {};
}

/**
 * remoteUrl → manifest entry.
 *
 * The manifest is keyed by content hash, which we can only compute after
 * downloading. Without this index every re-run re-fetches 610 MB from Stamped's
 * CDN just to discover it already has the file. Indexing by URL lets a re-run
 * skip the network entirely.
 */
function indexByRemoteUrl(manifest: Manifest): Map<string, ManifestEntry> {
  return new Map(Object.values(manifest).map((e) => [e.remoteUrl, e]));
}

/** Content-addressed name: same photo on two reviews collapses to one file. */
function outputNameFor(sha: string): string {
  return `${sha.slice(0, 12)}.webp`;
}

async function processOne(
  remoteUrl: string,
  manifest: Manifest,
): Promise<ManifestEntry> {
  const original = await getBuffer(remoteUrl, { timeoutMs: 120_000 });
  const sha = createHash("sha256").update(original).digest("hex");

  // Two reviews can carry the identical photo; hash tells us before we re-encode.
  const already = manifest[sha];
  if (already && fs.existsSync(path.join(OUT_DIR, path.basename(already.out)))) {
    return already;
  }

  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ORIGINALS_DIR, `${sha.slice(0, 12)}.orig`), original);

  const outName = outputNameFor(sha);
  const outPath = path.join(OUT_DIR, outName);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pipeline = sharp(original)
    // Honour EXIF orientation, then drop ALL metadata. These are phone photos
    // from real customers and may carry GPS coordinates — publishing those
    // would leak location data the reviewer never intended to share.
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true, fit: "inside" });

  const { data, info } = await pipeline
    .webp({ quality: WEBP_QUALITY, effort: 5 })
    .toBuffer({ resolveWithObject: true });

  fs.writeFileSync(outPath, data);

  const blur = await sharp(data).resize(20).webp({ quality: 40 }).toBuffer();

  return {
    sha256: sha,
    remoteUrl,
    originalBytes: original.byteLength,
    outputBytes: data.byteLength,
    width: info.width,
    height: info.height,
    out: `/reviews/img/${outName}`,
    blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
    fetchedAt: new Date().toISOString(),
  };
}

export async function run(): Promise<void> {
  const reviews = ReviewsFileSchema.parse(
    JSON.parse(fs.readFileSync(REVIEWS_PATH, "utf8")),
  );
  const manifest = loadManifest();

  // Only photos we are actually permitted to serve.
  const targets = new Map<string, Review>();
  for (const review of reviews) {
    if (!review.displayPolicy.canRehostPhotos) continue;
    for (const photo of review.photos) {
      if (photo.remoteUrl) targets.set(photo.remoteUrl, review);
    }
  }

  const blockedByPolicy = reviews
    .filter((r) => !r.displayPolicy.canRehostPhotos)
    .reduce((n, r) => n + r.photos.length, 0);

  console.log(`Photos to process: ${targets.size}`);
  console.log(`Blocked by rehost policy: ${blockedByPolicy}\n`);

  const limit = pLimit(CONCURRENCY);
  const cached = indexByRemoteUrl(manifest);
  const byRemoteUrl = new Map<string, ManifestEntry>();
  let done = 0;
  let failed = 0;
  let skipped = 0;

  await Promise.all(
    [...targets.keys()].map((remoteUrl) =>
      limit(async () => {
        try {
          // Already downloaded and optimized on a previous run — skip the fetch.
          const known = cached.get(remoteUrl);
          if (known && fs.existsSync(path.join(OUT_DIR, path.basename(known.out)))) {
            byRemoteUrl.set(remoteUrl, known);
            skipped += 1;
            return;
          }

          const entry = await processOne(remoteUrl, manifest);
          manifest[entry.sha256] = entry;
          byRemoteUrl.set(remoteUrl, entry);
        } catch (error) {
          failed += 1;
          console.warn(
            `  ✗ ${remoteUrl.split("/").pop()}: ${(error as Error).message.slice(0, 120)}`,
          );
        } finally {
          done += 1;
          if (done % 20 === 0) {
            console.log(`  … ${done}/${targets.size}`);
          }
        }
      }),
    ),
  );

  writeJsonAtomic(MANIFEST_PATH, manifest);

  // Fold the real dimensions and local paths back into the corpus. A photo that
  // failed to download stays rehosted:false and simply won't render — a missing
  // image is a much smaller problem than a broken one.
  const updated = reviews.map((review) => ({
    ...review,
    photos: review.photos.map((photo) => {
      const entry = photo.remoteUrl ? byRemoteUrl.get(photo.remoteUrl) : undefined;
      if (!entry) return photo;
      return {
        ...photo,
        sha256: entry.sha256,
        src: entry.out,
        width: entry.width,
        height: entry.height,
        blurDataUrl: entry.blurDataUrl,
        rehosted: true,
      };
    }),
  }));

  writeJsonAtomic(REVIEWS_PATH, ReviewsFileSchema.parse(updated));

  const entries = Object.values(manifest);
  const inBytes = entries.reduce((n, e) => n + e.originalBytes, 0);
  const outBytes = entries.reduce((n, e) => n + e.outputBytes, 0);
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

  console.log(`\n  downloaded: ${done - failed - skipped}`);
  console.log(`  cached:     ${skipped} (skipped, already on disk)`);
  console.log(`  failed:     ${failed}`);
  console.log(`  unique:     ${entries.length} files`);
  console.log(`  downloaded: ${mb(inBytes)}`);
  console.log(`  committed:  ${mb(outBytes)}  (${((1 - outBytes / inBytes) * 100).toFixed(1)}% smaller)`);
  console.log(`  → ${OUT_DIR}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
