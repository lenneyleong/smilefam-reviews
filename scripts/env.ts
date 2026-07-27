/**
 * Shared env loader for CLI scripts.
 *
 * Next.js loads .env / .env.local automatically; plain `dotenv/config` only
 * reads .env. Every script must import this FIRST, before anything that touches
 * process.env — scripts/apify.ts reads APIFY_API_KEY at module load.
 *
 * (Former requireApifyKey/requireAnthropicKey helpers were removed: nothing
 * called them — the Apify wrapper throws its own ApifyAuthError, and the
 * translate stub needs no key.)
 */
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true }); // .env — never overrides .env.local
