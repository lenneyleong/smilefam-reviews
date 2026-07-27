import fs from "node:fs";
import path from "node:path";

import {
  ANCHOR_MIX_TARGETS,
  type AnchorType,
  OUTBOUND,
  type OutboundKey,
} from "../lib/outbound-links";

/**
 * Anchor-text discipline audit for every outbound getsmilefam.com link.
 *
 * An exact-match brand domain whose every page points at one commercial site
 * with one repeated anchor is the textbook doorway signature. The defusal is a
 * measured mix — which requires that every outbound link go through the
 * lib/outbound-links.ts registry, where its anchor type is declared.
 *
 * Two severities:
 *   FAIL (exit 1)  — a bare getsmilefam.com href outside the registry. Those
 *                    links are invisible to this audit, which defeats it.
 *   WARN (exit 0)  — the mix is outside ANCHOR_MIX_TARGETS. The site is young
 *                    and a handful of placements swing the ratios hard, so
 *                    violations report loudly but do not fail. Tighten to a
 *                    failure once the placement count stabilises.
 *
 * Counting rule: one placement per (file, registry key) — site-wide furniture
 * (components/*) renders on every page but is authored once, and counting it
 * per rendered page would let a single footer link dominate the mix.
 */

const SCAN_DIRS = ["app", "components"];
const STORE_HOST = /href=\{?["'`]https?:\/\/(?:www\.)?getsmilefam\.com/;

interface Placement {
  file: string;
  line: number;
  key: string;
  type: AnchorType;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?|mdx?)$/.test(entry.name)) yield full;
  }
}

export async function run(): Promise<void> {
  const placements: Placement[] = [];
  const bareHrefs: Array<{ file: string; line: number; text: string }> = [];

  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const seenKeys = new Set<string>();

      lines.forEach((line, i) => {
        // Registry usage: OUTBOUND.<key>. Deduped per (file, key) — the .href
        // and .anchor accesses of one placement land on adjacent lines.
        for (const match of line.matchAll(/OUTBOUND\.([A-Za-z0-9_]+)/g)) {
          const key = match[1]!;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          const entry = OUTBOUND[key as OutboundKey];
          if (!entry) {
            bareHrefs.push({
              file,
              line: i + 1,
              text: `OUTBOUND.${key} is not a registered key`,
            });
            continue;
          }
          placements.push({ file, line: i + 1, key, type: entry.type });
        }

        // productLink() resolves harvested product handles → always contextual.
        const productLinkCalls = (line.match(/\bproductLink\(/g) ?? []).length;
        for (let k = 0; k < productLinkCalls; k += 1) {
          placements.push({
            file,
            line: i + 1,
            key: "productLink()",
            type: "contextual",
          });
        }

        // Bare store hrefs bypass the registry — the audit cannot see their
        // anchor type, so they are a hard failure.
        if (STORE_HOST.test(line)) {
          bareHrefs.push({ file, line: i + 1, text: line.trim().slice(0, 100) });
        }
      });
    }
  }

  // ------------------------------------------------------------- report
  const byType: Record<AnchorType, number> = {
    branded: 0,
    contextual: 0,
    navigational: 0,
    "exact-match": 0,
  };
  for (const p of placements) byType[p.type] += 1;
  const total = placements.length;

  console.log(`Outbound anchor audit — ${total} registry placements\n`);
  for (const p of placements) {
    console.log(
      `  ${p.type.padEnd(13)} ${p.key.padEnd(18)} ${p.file}:${p.line}`,
    );
  }

  console.log("\nMix vs targets:");
  let mixViolations = 0;
  for (const [type, target] of Object.entries(ANCHOR_MIX_TARGETS) as Array<
    [AnchorType, { min: number; max: number }]
  >) {
    const share = total === 0 ? 0 : byType[type] / total;
    const ok = share >= target.min && share <= target.max;
    if (!ok) mixViolations += 1;
    console.log(
      `  ${ok ? "✓" : "⚠"} ${type.padEnd(13)} ${(share * 100).toFixed(0).padStart(3)}%` +
        `  (target ${target.min * 100}–${target.max * 100}%, ${byType[type]} of ${total})`,
    );
  }
  if (mixViolations > 0) {
    console.warn(
      `\n⚠ ${mixViolations} anchor-type share(s) outside target — warning only ` +
        `while the site is young. Rebalance placements before it hardens.`,
    );
  }

  if (bareHrefs.length > 0) {
    console.error(
      `\n✗ ${bareHrefs.length} bare getsmilefam.com href(s) outside lib/outbound-links.ts:`,
    );
    for (const b of bareHrefs) {
      console.error(`  ${b.file}:${b.line} — ${b.text}`);
    }
    console.error(
      "\nRoute these through the OUTBOUND registry so the anchor mix stays measurable.",
    );
    throw new Error(`lint-anchors: ${bareHrefs.length} unregistered store link(s)`);
  }

  console.log("\n✓ no bare store hrefs — every outbound link is registered");
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
