import path from "node:path";

import {
  ACTOR_PRICING,
  type ActorKey,
  DEFAULT_MAX_RUN_USD,
  DEFAULT_MONTHLY_CAP_USD,
  estimateRunCostUsd,
  SAFETY_MARGIN_USD,
} from "./apify-pricing";
import { redact } from "./lib/redact";
import { readJsonIfExists, writeJsonAtomic } from "./lib/snapshot";

/**
 * Typed Apify client with a hard budget guard.
 *
 * The account cap is $29/month and a full harvest costs about $2.90, so money
 * is not the binding constraint — a runaway or repriced actor is. Hence three
 * independent ceilings, any one of which stops a run:
 *
 *   1. assertPricingUnchanged()  — the actor still costs what we recorded
 *   2. assertBudget()            — estimate + spent stays under cap - margin
 *   3. maxTotalChargeUsd         — Apify's own server-side ceiling on the run
 *
 * Every terminal run appends its REAL metered cost to data/cost-ledger.json,
 * which is committed, so lifetime spend is visible in git rather than only in
 * a dashboard.
 */

const API = "https://api.apify.com/v2";
const LEDGER_PATH = path.join("data", "cost-ledger.json");

// ---------------------------------------------------------------- errors

export class ApifyError extends Error {
  constructor(message: string) {
    super(redact(message));
    this.name = new.target.name;
  }
}

/** Refused before spending anything. Never retried. */
export class ApifyBudgetError extends ApifyError {}
/** Live price no longer matches the committed table. Never retried. */
export class ApifyPricingChangedError extends ApifyError {}
/** 401/403 — bad or missing token. Fatal. */
export class ApifyAuthError extends ApifyError {}
/** 400 — the actor's input schema drifted. Fatal; needs a code change. */
export class ApifyInputError extends ApifyError {}
/** 429 — retryable, honours Retry-After. */
export class ApifyRateLimitError extends ApifyError {
  constructor(message: string, readonly retryAfterMs: number | null) {
    super(message);
  }
}
/** 5xx / socket failures — retryable. */
export class ApifyTransientError extends ApifyError {}
/** Run reached FAILED / ABORTED / TIMED-OUT. Not retried automatically. */
export class ApifyRunFailedError extends ApifyError {}

// ---------------------------------------------------------------- client

function token(): string {
  const key = process.env.APIFY_API_KEY;
  if (!key) {
    throw new ApifyAuthError(
      "APIFY_API_KEY is not set. Add it to .env in the project root.",
    );
  }
  return key;
}

async function request<T>(
  method: "GET" | "POST",
  urlPath: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${urlPath}`, {
      method,
      headers: {
        // Always a header, never a query string — query strings end up in logs.
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApifyTransientError(
      `network failure calling ${urlPath}: ${(error as Error).message}`,
    );
  }

  if (res.ok) return (await res.json()) as T;

  const text = await res.text().catch(() => "");
  const detail = `${method} ${urlPath} → ${res.status}\n${text.slice(0, 600)}`;

  if (res.status === 401 || res.status === 403) throw new ApifyAuthError(detail);
  if (res.status === 400) throw new ApifyInputError(detail);
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new ApifyRateLimitError(
      detail,
      retryAfter ? Number(retryAfter) * 1000 : null,
    );
  }
  if (res.status >= 500) throw new ApifyTransientError(detail);
  throw new ApifyError(detail);
}

// ---------------------------------------------------------------- guards

export interface AccountLimits {
  capUsd: number;
  usedUsd: number;
  headroomUsd: number;
  cycleEndsAt: string | null;
  dataRetentionDays: number | null;
}

export async function getLimits(): Promise<AccountLimits> {
  const payload = await request<{
    data: {
      limits?: { maxMonthlyUsageUsd?: number; dataRetentionDays?: number };
      current?: { monthlyUsageUsd?: number };
      monthlyUsageCycle?: { endAt?: string };
    };
  }>("GET", "/users/me/limits");

  const accountCap =
    payload.data.limits?.maxMonthlyUsageUsd ?? DEFAULT_MONTHLY_CAP_USD;
  const envCap = Number(process.env.APIFY_MONTHLY_CAP_USD ?? Number.NaN);

  // An env override may only tighten the cap, never loosen it.
  const capUsd = Number.isFinite(envCap)
    ? Math.min(accountCap, envCap)
    : accountCap;

  // Fail closed: if Apify stops reporting current usage, "assume $0 spent"
  // would let every run through no matter what has already been billed this
  // cycle. An unreadable meter means no spending, not free spending.
  const usedUsd = payload.data.current?.monthlyUsageUsd;
  if (usedUsd === undefined) {
    throw new ApifyBudgetError(
      "Apify /users/me/limits returned no current.monthlyUsageUsd — cannot " +
        "establish spend this cycle. Refusing to run rather than assuming $0.",
    );
  }

  return {
    capUsd,
    usedUsd,
    headroomUsd: Math.max(0, capUsd - usedUsd),
    cycleEndsAt: payload.data.monthlyUsageCycle?.endAt ?? null,
    dataRetentionDays: payload.data.limits?.dataRetentionDays ?? null,
  };
}

/**
 * Our billing tier. Actor prices are tiered, so reading the wrong tier's price
 * would make the guard compare unrelated numbers. Cached for the process.
 */
let cachedTier: string | null = null;

export async function getAccountTier(): Promise<string> {
  if (cachedTier) return cachedTier;
  const payload = await request<{ data: { plan?: { tier?: string } } }>(
    "GET",
    "/users/me",
  );
  cachedTier = payload.data.plan?.tier ?? "BRONZE";
  return cachedTier;
}

/**
 * Confirm the actor still charges what apify-pricing.ts says it does.
 *
 * Deliberately fails closed: an unrecognised pricing shape is treated as a
 * price change, not as "probably fine". The whole point of this guard is the
 * case where an actor quietly reprices, and that is exactly when the payload
 * is most likely to look unfamiliar.
 */
export async function assertPricingUnchanged(key: ActorKey): Promise<void> {
  const expected = ACTOR_PRICING[key];
  const [payload, tier] = await Promise.all([
    request<{ data: { pricingInfos?: Array<Record<string, unknown>> } }>(
      "GET",
      `/acts/${expected.actorId}`,
    ),
    getAccountTier(),
  ]);

  const current = payload.data.pricingInfos?.at(-1);
  if (!current) {
    throw new ApifyPricingChangedError(
      `${expected.slug}: no pricing info returned — cannot verify cost before running`,
    );
  }

  const live = extractPerResultPrice(current, tier);
  if (live === null) {
    throw new ApifyPricingChangedError(
      `${expected.slug}: unrecognised pricing shape for tier ${tier}: ` +
        `${JSON.stringify(current).slice(0, 300)}\n` +
        `Re-verify the real price and update scripts/apify-pricing.ts deliberately.`,
    );
  }

  const drift = Math.abs(live - expected.perResultUsd);
  const tolerance = expected.perResultUsd * 0.001;
  if (drift > tolerance) {
    throw new ApifyPricingChangedError(
      `${expected.slug} price changed: committed $${expected.perResultUsd}/result, ` +
        `live $${live}/result at tier ${tier} (verified ${expected.verifiedOn}).\n` +
        `Refusing to run. Re-estimate the cost, then update scripts/apify-pricing.ts.`,
    );
  }
}

interface ChargeEvent {
  eventPriceUsd?: number;
  eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd?: number }>;
  isPrimaryEvent?: boolean;
}

/**
 * Pull the per-result unit price for our tier.
 *
 * Apify prices each charge event either flat (`eventPriceUsd`) or tiered
 * (`eventTieredPricingUsd[TIER].tieredEventPriceUsd`). The per-review event is
 * always tiered; only `apify-actor-start` is flat. Reading the flat field first
 * is what made an earlier version see $0 and refuse every run.
 */
function extractPerResultPrice(
  pricing: Record<string, unknown>,
  tier: string,
): number | null {
  const events = (
    pricing.pricingPerEvent as
      | { actorChargeEvents?: Record<string, ChargeEvent> }
      | undefined
  )?.actorChargeEvents;

  if (!events) return null;

  const candidates = Object.entries(events).filter(
    ([name, event]) =>
      event.isPrimaryEvent === true || /review|result|item/i.test(name),
  );
  if (candidates.length === 0) return null;

  const prices = candidates
    .map(([, event]) => {
      const tiered = event.eventTieredPricingUsd?.[tier]?.tieredEventPriceUsd;
      return tiered ?? event.eventPriceUsd;
    })
    .filter((n): n is number => typeof n === "number");

  if (prices.length === 0) return null;
  // The dearest per-result event is what dominates a large run.
  return Math.max(...prices);
}

export interface BudgetDecision {
  estimateUsd: number;
  limits: AccountLimits;
  maxRunUsd: number;
}

/**
 * Refuse any run that would breach the cap (minus the safety margin) or exceed
 * the per-run ceiling. Throws before a single request is billed.
 */
export async function assertBudget(input: {
  estimateUsd: number;
  yesSpendUsd?: number;
}): Promise<BudgetDecision> {
  const limits = await getLimits();
  // A malformed APIFY_MAX_RUN_USD (e.g. "3usd") must fall back to the default,
  // not become NaN — NaN makes both ceiling comparisons below false, which
  // silently disables two of the three budget guards.
  const envMaxRun = Number(process.env.APIFY_MAX_RUN_USD ?? Number.NaN);
  const maxRunUsd =
    input.yesSpendUsd ??
    (Number.isFinite(envMaxRun) ? envMaxRun : DEFAULT_MAX_RUN_USD);

  if (input.estimateUsd > maxRunUsd) {
    throw new ApifyBudgetError(
      `Estimated $${input.estimateUsd.toFixed(4)} exceeds the per-run ceiling ` +
        `of $${maxRunUsd.toFixed(2)}.\n` +
        `If that is genuinely intended, re-run with --yes-spend ${Math.ceil(input.estimateUsd)}.`,
    );
  }

  const ceiling = limits.capUsd - SAFETY_MARGIN_USD;
  if (limits.usedUsd + input.estimateUsd > ceiling) {
    throw new ApifyBudgetError(
      `Estimated $${input.estimateUsd.toFixed(4)} would take this cycle to ` +
        `$${(limits.usedUsd + input.estimateUsd).toFixed(4)}, past the safe ceiling of ` +
        `$${ceiling.toFixed(2)} (cap $${limits.capUsd}, spent $${limits.usedUsd.toFixed(4)}, ` +
        `margin $${SAFETY_MARGIN_USD}).\nRefusing to run.`,
    );
  }

  return { estimateUsd: input.estimateUsd, limits, maxRunUsd };
}

// ---------------------------------------------------------------- retry

const RETRYABLE = [ApifyRateLimitError, ApifyTransientError];

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseMs?: number; maxMs?: number; label?: string } = {},
): Promise<T> {
  const { retries = 4, baseMs = 1000, maxMs = 20_000, label = "apify" } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = RETRYABLE.some((E) => error instanceof E);
      if (!retryable || attempt === retries) throw error;

      const explicit =
        error instanceof ApifyRateLimitError ? error.retryAfterMs : null;
      // Jitter, so parallel harvests don't retry in lockstep.
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const waitMs = explicit ?? backoff * (0.5 + Math.random() * 0.5);

      console.warn(
        `  ${label}: attempt ${attempt + 1}/${retries + 1} failed, retrying in ${Math.round(waitMs)}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------- ledger

export interface LedgerEntry {
  runId: string;
  actorKey: ActorKey;
  actorId: string;
  slug: string;
  label: string;
  startedAt: string;
  finishedAt: string | null;
  /** "STARTED" is a provisional entry — the run was billed but not yet polled
   * to a terminal state. It is updated in place when the run finishes; a
   * lingering "STARTED" means the harvester process died mid-run. */
  status: string;
  itemCount: number;
  estimateUsd: number;
  /** What Apify actually metered. The number that matters. */
  usageTotalUsd: number | null;
  chargedEventCounts: Record<string, number> | null;
  headroomBeforeUsd: number;
  snapshot: string | null;
  /** Operational annotation, e.g. "superseded — re-harvested with PII redaction". */
  note?: string;
}

export function appendLedgerEntry(entry: LedgerEntry): void {
  const ledger = readJsonIfExists<LedgerEntry[]>(LEDGER_PATH) ?? [];
  ledger.push(entry);
  writeJsonAtomic(LEDGER_PATH, ledger);
}

/** Patch an existing entry in place, keyed by runId. */
export function updateLedgerEntry(
  runId: string,
  patch: Partial<LedgerEntry>,
): void {
  const ledger = readJsonIfExists<LedgerEntry[]>(LEDGER_PATH) ?? [];
  const index = ledger.findIndex((e) => e.runId === runId);
  if (index === -1) return;
  ledger[index] = { ...ledger[index]!, ...patch };
  writeJsonAtomic(LEDGER_PATH, ledger);
}

/**
 * Called by each harvester right after writeSnapshot, so the ledger records
 * which committed snapshot a paid run produced. Without this, `snapshot` stays
 * permanently null and the money → evidence link is lost.
 */
export function updateLedgerSnapshot(runId: string, snapshotPath: string): void {
  updateLedgerEntry(runId, { snapshot: snapshotPath });
}

export function lifetimeSpendUsd(): number {
  const ledger = readJsonIfExists<LedgerEntry[]>(LEDGER_PATH) ?? [];
  return ledger.reduce((n, e) => n + (e.usageTotalUsd ?? 0), 0);
}

// ---------------------------------------------------------------- run

export interface RunActorOptions<TIn> {
  actorKey: ActorKey;
  input: TIn;
  /** Drives the cost estimate. Be pessimistic here, not optimistic. */
  expectedResults: number;
  label: string;
  yesSpendUsd?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface RunActorResult<TOut> {
  items: TOut[];
  runId: string;
  status: string;
  usageTotalUsd: number | null;
  chargedEventCounts: Record<string, number> | null;
}

export async function runActor<TIn, TOut>(
  options: RunActorOptions<TIn>,
): Promise<RunActorResult<TOut>> {
  const pricing = ACTOR_PRICING[options.actorKey];
  const estimateUsd = estimateRunCostUsd(options.actorKey, options.expectedResults);

  await assertPricingUnchanged(options.actorKey);
  const decision = await assertBudget({
    estimateUsd,
    yesSpendUsd: options.yesSpendUsd,
  });

  console.log(
    `  ${options.label}: est $${estimateUsd.toFixed(4)} for ~${options.expectedResults} results ` +
      `(spent $${decision.limits.usedUsd.toFixed(4)} of $${decision.limits.capUsd})`,
  );

  // Third ceiling: Apify enforces this server-side even if our estimate is
  // wrong. Rounded up so a correct run is never killed by a rounding error.
  const maxTotalChargeUsd = Math.max(
    0.01,
    Math.ceil(Math.min(estimateUsd * 3, decision.maxRunUsd) * 100) / 100,
  );

  // The run-creation POST is NOT idempotent and is deliberately NEVER retried:
  // a dropped response after the server accepted the request would mean a
  // second, double-billed run. Only the GETs below are retryable.
  const started = await request<{ data: { id: string } }>(
    "POST",
    `/acts/${pricing.actorId}/runs?maxTotalChargeUsd=${maxTotalChargeUsd}`,
    options.input,
  );

  const runId = started.data.id;
  const startedAt = new Date().toISOString();
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000);

  // Provisional ledger entry the moment we know the runId. If this process is
  // killed mid-poll, the committed ledger still shows a run was started (and
  // therefore billed) instead of the spend silently vanishing.
  appendLedgerEntry({
    runId,
    actorKey: options.actorKey,
    actorId: pricing.actorId,
    slug: pricing.slug,
    label: options.label,
    startedAt,
    finishedAt: null,
    status: "STARTED",
    itemCount: 0,
    estimateUsd,
    usageTotalUsd: null,
    chargedEventCounts: null,
    headroomBeforeUsd: decision.limits.headroomUsd,
    snapshot: null,
  });

  let run: {
    status: string;
    defaultDatasetId: string;
    usageTotalUsd?: number;
    chargedEventCounts?: Record<string, number>;
    finishedAt?: string;
  };

  // ABORTING and TIMING-OUT are transitional — treating them as terminal reads
  // the usage figure before Apify finishes metering the run.
  const NON_TERMINAL = new Set(["READY", "RUNNING", "ABORTING", "TIMING-OUT"]);

  for (;;) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const polled = await withRetry(
      () => request<{ data: typeof run }>("GET", `/actor-runs/${runId}`),
      { label: `${options.label} poll` },
    );
    run = polled.data;

    if (!NON_TERMINAL.has(run.status)) break;
    if (Date.now() > deadline) {
      throw new ApifyRunFailedError(
        `${options.label}: run ${runId} still ${run.status} after timeout`,
      );
    }
  }

  const usageTotalUsd = run.usageTotalUsd ?? null;
  const chargedEventCounts = run.chargedEventCounts ?? null;

  let items: TOut[] = [];
  if (run.status === "SUCCEEDED") {
    items = await withRetry(
      () =>
        request<TOut[]>(
          "GET",
          `/datasets/${run.defaultDatasetId}/items?clean=true`,
        ),
      { label: `${options.label} dataset` },
    );
  }

  // Promote the provisional "STARTED" entry to its terminal record.
  updateLedgerEntry(runId, {
    finishedAt: run.finishedAt ?? null,
    status: run.status,
    itemCount: items.length,
    usageTotalUsd,
    chargedEventCounts,
  });

  if (run.status !== "SUCCEEDED") {
    throw new ApifyRunFailedError(
      `${options.label}: run ${runId} ended ${run.status} ` +
        `(charged $${usageTotalUsd ?? 0})`,
    );
  }

  console.log(
    `  ${options.label}: ${items.length} items, charged $${(usageTotalUsd ?? 0).toFixed(4)}`,
  );

  return { items, runId, status: run.status, usageTotalUsd, chargedEventCounts };
}
