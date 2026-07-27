/**
 * Every outbound link to getsmilefam.com lives here.
 *
 * Why a registry rather than inline anchors: an exact-match brand domain whose
 * every page points at one commercial site with one repeated anchor is the
 * textbook doorway/PBN signature. Varying the anchor text is the main defusal,
 * and anchor discipline you cannot measure is anchor discipline you do not have.
 *
 * `scripts/lint-anchors.ts` reads this file and fails the build if the mix
 * drifts outside the targets below.
 *
 * Note on expectations: links between commonly-owned properties are heavily
 * discounted by search engines, and shared registrant/pixel/GBP data makes the
 * ownership obvious. These links earn referral traffic and entity association,
 * not PageRank. They are placed to be useful to a reader, which is also the
 * only placement that survives scrutiny.
 */

export const STORE = "https://getsmilefam.com";

export type AnchorType =
  /** "SmileFam", "getsmilefam.com" — target ~45% */
  | "branded"
  /** "view the BLU Whitening Kit", "check the current price" — target ~30% */
  | "contextual"
  /** "official store", "product page" — target ~15% */
  | "navigational"
  /** "teeth whitening kit Singapore" — hard ceiling 10% */
  | "exact-match";

export interface OutboundLink {
  href: string;
  anchor: string;
  type: AnchorType;
}

export const ANCHOR_MIX_TARGETS: Record<AnchorType, { min: number; max: number }> =
  {
    branded: { min: 0.35, max: 0.6 },
    contextual: { min: 0.2, max: 0.4 },
    navigational: { min: 0.05, max: 0.25 },
    "exact-match": { min: 0, max: 0.1 },
  };

/**
 * Named links, so the same destination is never described the same way twice
 * across the site. Pick the one that reads naturally in context.
 */
export const OUTBOUND = {
  storeBranded: {
    href: STORE,
    anchor: "SmileFam",
    type: "branded",
  },
  storeNaked: {
    href: STORE,
    anchor: "getsmilefam.com",
    type: "branded",
  },
  storeOfficial: {
    href: STORE,
    anchor: "official store",
    type: "navigational",
  },
  /** The site-wide footer link. Registered so the audit can see it. */
  footerStore: {
    href: STORE,
    anchor: "getsmilefam.com",
    type: "navigational",
  },
  bluKitPrice: {
    href: `${STORE}/products/blu-teeth-whitening-kit`,
    anchor: "check the current price",
    type: "contextual",
  },
  bluKitProduct: {
    href: `${STORE}/products/blu-teeth-whitening-kit`,
    anchor: "the BLU Whitening Kit",
    type: "contextual",
  },
  toothbrushProduct: {
    href: `${STORE}/products/smilefam-bundle-kit`,
    anchor: "the Whitening Electric Toothbrush",
    type: "contextual",
  },
  warranty: {
    href: `${STORE}/pages/faq`,
    anchor: "warranty and returns",
    type: "contextual",
  },
} as const satisfies Record<string, OutboundLink>;

export type OutboundKey = keyof typeof OUTBOUND;

/**
 * Product links resolved from harvested Shopify data rather than hardcoded, so
 * a renamed handle can never become a 404 we don't notice.
 */
export function productLink(
  handle: string | null,
  name: string,
): OutboundLink | null {
  if (!handle) return null;
  return {
    href: `${STORE}/products/${handle}`,
    anchor: name,
    type: "contextual",
  };
}
