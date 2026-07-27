import { redact } from "./redact";

/**
 * Minimal fetch wrapper for the free (non-Apify) endpoints: Stamped, Shopify's
 * products.json, Shopee's shop-detail API. Apify has its own wrapper with a
 * budget guard — this one only needs to be polite and to fail loudly.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(redact(message));
    this.name = "HttpError";
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  // Identify ourselves honestly. These are public endpoints and there is no
  // reason to pretend to be a browser we aren't.
  "User-Agent":
    "SmileFamReviewsBot/1.0 (+https://smilefamreviews.com; review archive for getsmilefam.com)",
  Accept: "application/json",
  "Accept-Language": "en-SG,en;q=0.9",
};

export async function getJson<T>(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const { headers = {}, timeoutMs = 30_000 } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new HttpError(
        `GET ${url} → ${res.status} ${res.statusText}\n${body.slice(0, 500)}`,
        res.status,
        url,
      );
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBuffer(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<Buffer> {
  const { timeoutMs = 60_000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"]! },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new HttpError(
        `GET ${url} → ${res.status} ${res.statusText}`,
        res.status,
        url,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Be a good citizen against endpoints that owe us nothing. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
