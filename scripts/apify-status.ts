import "./env";

import { assertBudget, ApifyBudgetError, getLimits, lifetimeSpendUsd } from "./apify";
import { ACTOR_PRICING, estimateRunCostUsd } from "./apify-pricing";

/**
 * Account status + budget-guard self-test.
 *
 * The self-test matters more than the status readout: a guard that has never
 * been observed refusing anything is a guard nobody knows is wired up. This
 * asserts it throws on a deliberately absurd estimate before we trust it with
 * real runs.
 */

async function main(): Promise<void> {
  const limits = await getLimits();

  console.log("Apify account");
  console.log(`  monthly cap:     $${limits.capUsd.toFixed(2)}`);
  console.log(`  spent this cycle:$${limits.usedUsd.toFixed(4)}`);
  console.log(`  headroom:        $${limits.headroomUsd.toFixed(4)}`);
  console.log(`  cycle ends:      ${limits.cycleEndsAt ?? "unknown"}`);
  console.log(`  data retention:  ${limits.dataRetentionDays ?? "?"} days`);
  console.log(`  lifetime (ledger): $${lifetimeSpendUsd().toFixed(4)}`);

  console.log("\nPlanned run estimates");
  const planned: Array<[keyof typeof ACTOR_PRICING, number]> = [
    ["google", 1500],
    ["shopee", 508],
    ["facebook", 120],
  ];
  let total = 0;
  for (const [key, n] of planned) {
    const usd = estimateRunCostUsd(key, n);
    total += usd;
    console.log(`  ${key.padEnd(9)} ~${String(n).padStart(5)} results  $${usd.toFixed(4)}`);
  }
  console.log(`  ${"TOTAL".padEnd(9)} ${" ".repeat(14)}$${total.toFixed(4)}`);

  console.log("\nBudget guard self-test");
  try {
    await assertBudget({ estimateUsd: 50 });
    console.error("  ✗ FAIL — a $50 run was permitted. The guard is not working.");
    process.exit(1);
  } catch (error) {
    if (error instanceof ApifyBudgetError) {
      console.log("  ✓ refused a $50 run:");
      console.log(
        error.message
          .split("\n")
          .map((l) => `      ${l}`)
          .join("\n"),
      );
    } else {
      throw error;
    }
  }

  // And confirm a realistic run is NOT refused — a guard that blocks everything
  // is just as broken as one that blocks nothing.
  const realistic = estimateRunCostUsd("google", 1500);
  await assertBudget({ estimateUsd: realistic });
  console.log(`  ✓ permitted a realistic $${realistic.toFixed(4)} run`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
