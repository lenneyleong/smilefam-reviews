import "../env";

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { getJson } from "../lib/http";
import { writeJsonAtomic } from "../lib/snapshot";

/**
 * Build the canonical product map from getsmilefam.com's public products.json.
 *
 * This is free and unauthenticated, and it is the only reliable bridge between
 * a Stamped review and a real store URL: Stamped's own `productUrl` is an
 * opaque redirect (stamped.io/go/<blob>), useless as a backlink. Its numeric
 * `productId` IS the Shopify product ID, which this file resolves to a handle.
 *
 * Every outbound product link on the site is derived from here, so a product
 * that isn't in this map simply doesn't get a link rather than getting a guess.
 */

const STORE = "https://getsmilefam.com";
const OUT = path.join("data", "products.json");

const ShopifyProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  product_type: z.string().optional(),
  variants: z
    .array(z.object({ sku: z.string().nullable().optional(), price: z.string().optional() }))
    .optional(),
});

export const ProductRecordSchema = z.object({
  shopifyProductId: z.string(),
  title: z.string(),
  /** Shopify's handle — also our /products/<slug> route. */
  handle: z.string(),
  url: z.url(),
  productType: z.string().nullable(),
  skus: z.array(z.string()),
  priceSgd: z.string().nullable(),
});
export type ProductRecord = z.infer<typeof ProductRecordSchema>;

export function loadProductMap(): Map<string, ProductRecord> {
  if (!fs.existsSync(OUT)) return new Map();
  const rows = z
    .array(ProductRecordSchema)
    .parse(JSON.parse(fs.readFileSync(OUT, "utf8")));
  return new Map(rows.map((r) => [r.shopifyProductId, r]));
}

export async function run(): Promise<void> {
  const payload = await getJson<{ products: unknown[] }>(
    `${STORE}/products.json?limit=250`,
  );

  const products: ProductRecord[] = payload.products
    .map((raw) => ShopifyProductSchema.parse(raw))
    .map((p) => ({
      shopifyProductId: String(p.id),
      title: p.title,
      handle: p.handle,
      url: `${STORE}/products/${p.handle}`,
      productType: p.product_type?.trim() ? p.product_type : null,
      skus: (p.variants ?? [])
        .map((v) => v.sku)
        .filter((s): s is string => Boolean(s)),
      priceSgd: p.variants?.[0]?.price ?? null,
    }))
    .sort((a, b) => a.handle.localeCompare(b.handle));

  writeJsonAtomic(OUT, products);
  // Prices get their own timestamp: the cost page must never stamp a price
  // with the REVIEW sync date, which moves whenever any review harvest runs.
  writeJsonAtomic(path.join("data", "products.meta.json"), {
    fetchedAt: new Date().toISOString(),
    source: `${STORE}/products.json`,
    productCount: products.length,
  });

  console.log(`Wrote ${products.length} products → ${OUT}`);
  for (const p of products) {
    console.log(`  ${p.shopifyProductId}  ${p.handle}  (S$${p.priceSgd ?? "?"})`);
  }
}

// Guarded: this module is also imported by the review adapters for
// `loadProductMap`, and importing it must not trigger a network fetch.
if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
