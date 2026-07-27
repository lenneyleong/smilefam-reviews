import { createHash } from "node:crypto";

/** sha256 hex of a UTF-8 string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Reduce a display name to "First L." form.
 *
 * Singapore's PDPA governs republishing personal data, so no surname ever
 * reaches the page. Stamped already masks upstream ("Mona R."), which this
 * function leaves untouched; Google and Shopee return full names, which it
 * cuts down.
 *
 * Falls back to "Anonymous" rather than throwing — a review with an
 * unparseable name is still a real review and should still be displayed.
 */
export function maskAuthorName(raw: string | null | undefined): {
  display: string;
  maskApplied: "none" | "first-name-initial" | "platform-masked";
} {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { display: "Anonymous", maskApplied: "none" };

  const parts = name.split(" ");
  if (parts.length === 1) {
    return { display: parts[0]!, maskApplied: "none" };
  }

  const first = parts[0]!;
  const last = parts[parts.length - 1]!;

  // Already in "Mona R." or "Mona R" form — nothing to strip.
  if (/^[A-Za-z]\.?$/.test(last)) {
    return {
      display: `${first} ${last.replace(/\.?$/, ".")}`,
      maskApplied: "platform-masked",
    };
  }

  const initial = [...last][0];
  if (!initial) return { display: first, maskApplied: "first-name-initial" };

  return {
    display: `${first} ${initial.toUpperCase()}.`,
    maskApplied: "first-name-initial",
  };
}

/**
 * Normalization used only for `contentKey`. Deliberately lossy: it exists to
 * spot the same review cross-posted to two platforms, not to alter display text.
 */
export function normalizeForContentKey(body: string): string {
  return body
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim()
    .slice(0, 160);
}

/** Day-precision date string in UTC. Keeps re-run diffs clean. */
export function toDayString(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Map franc-min's ISO 639-3 output to the BCP-47 tags we actually care about
 * in Singapore. Anything else is treated as English rather than guessed at —
 * a wrong language tag on a `lang` attribute is worse than no tag.
 */
const ISO3_TO_BCP47: Record<string, string> = {
  eng: "en",
  cmn: "zh-Hans",
  zsm: "ms",
  tam: "ta",
};

export function toBcp47(iso3: string): string {
  return ISO3_TO_BCP47[iso3] ?? "en";
}

/**
 * Language detection is unreliable on short strings — "Very good!" gets
 * classified as anything. Below this length we assume English rather than
 * sending a two-word review through a translator.
 */
export const MIN_CHARS_FOR_LANGUAGE_DETECTION = 20;
