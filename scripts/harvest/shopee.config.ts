/**
 * Shopee product URLs to scrape reviews from.
 *
 * These have to be pasted in by hand. Shopee's shop-item listing endpoints
 * (`/api/v4/shop/search_items`, `/api/v4/search/search_items`,
 * `/api/v4/recommend/recommend`) all return HTTP 403 behind anti-bot, and no
 * free programmatic path was found. The free `get_shop_detail` endpoint gives
 * us the shop-level rating breakdown but not the item IDs.
 *
 * HOW TO FILL THIS IN (about two minutes):
 *   1. Open https://shopee.sg/smilefam in a browser
 *   2. Click each of the 5 products
 *   3. Copy the URL from the address bar — it ends in `-i.1362689438.<itemid>`
 *   4. Paste each below and delete the `placeholder: true` guard
 *
 * The Apify actor needs the full URL in that `-i.<shopid>.<itemid>` form.
 * `scripts/harvest/shopee.ts` refuses to run while this list is empty rather
 * than guessing IDs and paying for a run that returns nothing.
 */

export const SHOPEE_SHOP_ID = "1362689438";

export interface ShopeeProductTarget {
  url: string;
  /** For logging only — the real product mapping comes from the review data. */
  label: string;
}

export const SHOPEE_PRODUCTS: ShopeeProductTarget[] = [
  // Example of the expected shape:
  // {
  //   url: "https://shopee.sg/SmileFam-BLU-Teeth-Whitening-Kit-i.1362689438.28734512095",
  //   label: "BLU Teeth Whitening Kit",
  // },
];

export function assertShopeeConfigured(): void {
  if (SHOPEE_PRODUCTS.length === 0) {
    throw new Error(
      "No Shopee product URLs configured.\n\n" +
        "Shopee's item-listing API is 403 behind anti-bot, so the 5 product URLs\n" +
        "must be pasted into scripts/harvest/shopee.config.ts by hand.\n\n" +
        "Open https://shopee.sg/smilefam, click each product, and copy the URL —\n" +
        "it ends in `-i.1362689438.<itemid>`.\n\n" +
        "Refusing to run rather than paying for a scrape with no targets.",
    );
  }
}
