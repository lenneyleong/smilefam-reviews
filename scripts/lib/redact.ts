/**
 * Scrub secrets from anything headed for a log, an error message, or a stack
 * trace. Wired into the Apify wrapper's error constructors so a 500 response
 * body that echoes the request can't leak the token into the terminal or CI.
 */

const PATTERNS: RegExp[] = [
  /apify_api_[A-Za-z0-9_]+/g,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

export function redact(input: unknown): string {
  let text =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? `${input.message}\n${input.stack ?? ""}`
        : safeStringify(input);

  for (const pattern of PATTERNS) {
    text = text.replace(pattern, (match) => {
      const prefix = match.slice(0, Math.min(12, match.length));
      return `${prefix}***REDACTED***`;
    });
  }
  return text;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
