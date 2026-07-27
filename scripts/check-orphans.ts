import "./env";

import fs from "node:fs";
import path from "node:path";

import { FACETS, MAX_PAGES, PAGE_SIZE } from "../lib/browse";
import { getAllReviews } from "../lib/data";

/**
 * Internal-link graph audit: no sitemap URL may be an orphan.
 *
 * A route in the sitemap that almost nothing links to is the classic "made for
 * the sitemap, not for readers" signature, and it also starves that page of
 * crawl priority. Rule enforced here: every sitemap route needs at least TWO
 * distinct inbound source routes — where all site-wide furniture (header nav +
 * footer, components/PageFurniture.tsx) collectively counts as ONE source, so
 * a page linked only from the footer still fails. "/" is exempt.
 *
 * The graph is built from three places:
 *   1. literal internal hrefs in app/** and components/** (both `href="/x"`
 *      JSX and `href: "/x"` array entries — NAV, BUYER_QUESTIONS, etc.);
 *   2. the ReviewBrowser's structural links, modelled from lib/browse data:
 *      every browser page renders the facet nav (→ /reviews + every facet
 *      front) and pagination anchors (→ first/last/±2 pages of its own list);
 *   3. the sitemap's own route enumeration (mirroring app/sitemap.ts, which
 *      lists every pagination page up to MAX_PAGES).
 */

const SITEMAP_PAGE_CAP = MAX_PAGES; // mirrors app/sitemap.ts

const FURNITURE_FILES = new Set(["components/PageFurniture.tsx"]);
const FURNITURE_SOURCE = "__furniture__";

// ------------------------------------------------------------ route model

function browserListSizes(): Array<{ base: string; totalPages: number; facet: string | null }> {
  const lists: Array<{ base: string; totalPages: number; facet: string | null }> = [
    {
      base: "/reviews",
      totalPages: Math.min(Math.ceil(getAllReviews().length / PAGE_SIZE), MAX_PAGES),
      facet: null,
    },
  ];
  for (const facet of FACETS) {
    lists.push({
      base: `/reviews/${facet.slug}`,
      totalPages:
        facet.slug === "critical"
          ? 1 // /reviews/critical is a single static page
          : Math.min(Math.ceil(facet.select().length / PAGE_SIZE), MAX_PAGES),
      facet: facet.slug,
    });
  }
  return lists;
}

/** The sitemap's URL set, mirroring app/sitemap.ts. */
function sitemapRoutes(): Set<string> {
  const routes = new Set<string>([
    "/",
    "/methodology",
    "/about",
    "/photos",
    "/is-smilefam-legit",
    "/smilefam-complaints-and-negative-reviews",
    "/does-smilefam-actually-work",
    "/how-much-does-smilefam-cost",
    "/where-to-buy-smilefam-in-singapore",
  ]);
  for (const list of browserListSizes()) {
    routes.add(list.base);
    const capped = Math.min(list.totalPages, SITEMAP_PAGE_CAP);
    for (let n = 2; n <= capped; n += 1) routes.add(`${list.base}/page/${n}`);
  }
  return routes;
}

// ------------------------------------------------------------- link graph

/** route → set of distinct source routes linking to it */
type Inbound = Map<string, Set<string>>;

function addEdge(inbound: Inbound, from: string, to: string): void {
  const target = to.replace(/\/+$/, "") || "/";
  if (!inbound.has(target)) inbound.set(target, new Set());
  inbound.get(target)!.add(from);
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) yield full;
  }
}

/** app/foo/bar/page.tsx → /foo/bar; app/page.tsx → / */
function routeForPageFile(file: string): string | null {
  const match = /^app\/(?:(.*)\/)?page\.tsx$/.exec(file.replace(/\\/g, "/"));
  if (!match) return null;
  const segment = match[1] ?? "";
  if (segment.includes("[")) return null; // dynamic — modelled structurally
  return segment ? `/${segment}` : "/";
}

const HREF_LITERAL = /href(?:=\{?|:\s*)["'`](\/[^"'`#?]*)["'`]/g;

function literalHrefs(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const hrefs: string[] = [];
  for (const match of source.matchAll(HREF_LITERAL)) {
    hrefs.push(match[1]!);
  }
  return hrefs;
}

function buildInbound(): Inbound {
  const inbound: Inbound = new Map();

  // 1. Literal hrefs. Static pages contribute as themselves; site-wide
  //    furniture contributes as the single __furniture__ source; other shared
  //    components (ReviewCard, SourceLedger…) are attributed to furniture too
  //    conservatively? No — they are skipped here and modelled structurally
  //    below when they matter (ReviewBrowser). Attributing a card rendered on
  //    ninety pages to ninety sources would hide real orphans.
  for (const file of walk("app")) {
    const route = routeForPageFile(file);
    if (!route) continue;
    for (const href of literalHrefs(file)) addEdge(inbound, route, href);
  }
  for (const file of walk("components")) {
    const rel = file.replace(/\\/g, "/");
    if (!FURNITURE_FILES.has(rel)) continue;
    for (const href of literalHrefs(file)) {
      addEdge(inbound, FURNITURE_SOURCE, href);
    }
  }

  // 2. ReviewBrowser structural links: every browser page instance links the
  //    facet nav and its own pagination window.
  const lists = browserListSizes();
  const facetFronts = lists.map((l) => l.base);
  for (const list of lists) {
    if (list.facet === "critical") continue; // static page, handled via literals
    for (let page = 1; page <= list.totalPages; page += 1) {
      const from = page === 1 ? list.base : `${list.base}/page/${page}`;

      // FacetNav: /reviews + every facet front, from every browser page.
      addEdge(inbound, from, "/reviews");
      for (const front of facetFronts) addEdge(inbound, from, front);

      // Pagination: first, last, and ±2 around the current page.
      if (list.totalPages > 1) {
        const targets = new Set<number>([1, list.totalPages]);
        for (let n = page - 2; n <= page + 2; n += 1) {
          if (n >= 1 && n <= list.totalPages) targets.add(n);
        }
        for (const n of targets) {
          if (n === page) continue;
          addEdge(inbound, from, n === 1 ? list.base : `${list.base}/page/${n}`);
        }
      }
    }
  }

  return inbound;
}

// -------------------------------------------------------------------- main

export async function run(): Promise<void> {
  const inbound = buildInbound();
  const routes = sitemapRoutes();

  const failures: string[] = [];
  console.log(`Orphan check — ${routes.size} sitemap routes\n`);

  const sorted = [...routes].sort();
  for (const route of sorted) {
    if (route === "/") continue; // the homepage needs no inbound links
    const sources = inbound.get(route) ?? new Set<string>();
    const ok = sources.size >= 2;
    if (!ok) {
      failures.push(route);
      const list = [...sources].join(", ") || "nothing";
      console.error(
        `  ✗ ${route.padEnd(48)} ${sources.size} inbound (${list})`,
      );
    }
  }

  const checked = routes.size - 1;
  console.log(`\n  ${checked - failures.length} of ${checked} routes have ≥2 distinct inbound sources`);
  console.log("  (all site-wide furniture counts as one source)");

  if (failures.length > 0) {
    console.error(
      `\n✗ ${failures.length} sitemap route(s) with fewer than 2 inbound links:`,
    );
    for (const route of failures) console.error(`    ${route}`);
    console.error(
      "\nAdd contextual links from related pages (or drop the route from the sitemap).",
    );
    throw new Error(`check-orphans: ${failures.length} under-linked route(s)`);
  }

  console.log("\n✓ no orphaned sitemap routes");
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
