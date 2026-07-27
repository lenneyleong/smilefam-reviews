---
name: security-audit
description: Audit a project (and the host it lives on) for leaked credentials, exposed services, and common security gaps. Use when the user asks to "audit this codebase," "check for leaked keys," "review security," "is anything exposed," "what's listening on this server," before deploying to a new host, or after suspecting a credential leak. Produces a prioritized markdown report and offers safe remediation steps.
---

# Security Audit Skill

A reusable, multi-phase security audit for a project directory and the host it
runs on. It catches the most common ways secrets and services get exposed:
credentials committed or duplicated outside `.env`, dev servers left bound to
public interfaces, command-injection and path-traversal bugs, and unverified
"is this key still live?" questions after a suspected leak. Each phase produces
concrete, prioritized findings and safe remediation steps.

## When to invoke

Trigger phrases: "security audit", "check for leaked keys", "any open keys",
"is anything exposed", "are these credentials safe", "audit this project",
"review the security of...", "before I push this", "what's listening on this
server", "did we leak anything".

If the user names a specific concern ("just check listening ports", "just scan
.env files"), jump straight to the relevant phase. Otherwise run all phases in
order.

## Operating principles

1. **Defense in layers.** A single finding rarely tells the whole story. Run
   every phase even if Phase 1 looks clean — secrets correctly stored in `.env`
   can still leak if a forgotten dev server in the project root is serving the
   file to the internet. Permission checks alone won't catch that; you also need
   to check listening ports.

2. **Verify before declaring "leaked."** When you find a key in a place it
   shouldn't be, hit the provider's API with it (using a SAFE method — see
   Phase 4) to confirm whether it's still valid. A revoked key in a public file
   is dead text, not an emergency.

3. **Never run a verification request that triggers billable work or queues
   real jobs.** Assume any successful request to a generative-AI provider will
   be billed. Use auth-only check endpoints, deliberately malformed payloads
   that fail validation post-auth, or list/account/status endpoints.

4. **Pause before destructive remediation.** `kill`, `rm`, `chmod`, `ufw enable`,
   `git reset`, etc. are all destructive in different ways. Always show the
   user the command and the expected effect, and confirm before running, unless
   the user has already authorized that specific action in the current session.

5. **`chmod 600` is NOT sufficient.** A process running as root can read any
   file regardless of mode and serve it over the network. File-permission
   hardening must always be paired with network-layer controls (firewall +
   correct interface binding).

6. **Report concretely.** Every finding should include file path, line number,
   a redacted snippet (first 6 chars + ellipsis for secrets), severity, and a
   one-line fix. Vague findings get ignored.

---

## Phase 1 — Host triage (5 minutes)

The fastest, highest-signal checks. Run these first because they catch
"actively leaking right now" issues.

### 1.1 Listening sockets

```bash
ss -tunlp
```

Identify every listener whose `Local Address` is `0.0.0.0:*`, `[::]:*`, or any
public IP — these are reachable from the internet (subject to firewall).
Anything bound to `127.0.0.1`, `[::1]`, or a Unix socket is loopback-only and
safe to ignore.

For each public listener, capture the process: cwd, cmdline, start time, and
user.

```bash
for pid in <PID> ...; do
  echo "=== $pid ==="
  ls -l /proc/$pid/cwd 2>&1
  cat /proc/$pid/cmdline 2>&1 | tr '\0' ' '; echo
  ps -o lstart=,user= -p $pid
done
```

Red flags:
- `python3 -m http.server` or `python3 -c "...HTTPServer..."` with cwd in a
  project directory containing `.env`
- `npx http-server` / `serve` / `npx serve` not bound to localhost
- Any node/express/fastify server bound to `0.0.0.0` that isn't supposed to
  be public
- Anything running as `root` that doesn't need to be

Test the ones that look concerning:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}  size=%{size_download}\n" \
  http://127.0.0.1:<PORT>/.env
```

`HTTP 200` with a non-zero size means the server is actively serving the
secrets file. Treat as a confirmed leak.

### 1.2 Host firewall state

```bash
ufw status verbose 2>&1
iptables -L INPUT -n 2>&1 | head
```

If `ufw` is `inactive` and `iptables` `INPUT` policy is `ACCEPT` with no rules,
the host has zero network-layer protection. Whether ports are reachable depends
entirely on the cloud provider's edge firewall — which the user should verify
in the provider dashboard (DigitalOcean: Networking → Firewalls; AWS: Security
Groups; etc.).

### 1.3 Public IP

```bash
curl -s --max-time 5 ifconfig.me
```

Useful for the report and for the user's dashboard checks.

### 1.4 Sensitive file permissions

For the project directory and any related files outside it:

```bash
ls -la <project>/.env <project>/.mcp.json <project>/.claude/settings.local.json 2>&1
ls -la <project>.tar.gz <project>.zip 2>&1 # archive copies sometimes linger
find <project> -name '.env*' -o -name 'cookies.json' -o -name 'session.json' \
  -o -name 'credentials*.json' -o -name '*.pem' -o -name '*.key' 2>&1
```

Anything with mode `644`, `664`, `666`, or world-anything is a finding.
**Mode `600` is the minimum acceptable for a secrets file** (and even that
doesn't protect against same-user processes — see principle 5).

---

## Phase 2 — Secret scan (10 minutes)

Find every hardcoded credential in the project, *including* the ones that are
"supposed to" be in `.env` but have been pasted elsewhere (settings files,
audit logs, output JSON, README screenshots, archived tarballs).

### 2.1 Common credential patterns

Run a single grep across the project, skipping `node_modules`:

| Pattern | Provider |
|---|---|
| `sk_live_[A-Za-z0-9]+` | Stripe live secret (full access) |
| `rk_live_[A-Za-z0-9]+` | Stripe live restricted |
| `sk_test_[A-Za-z0-9]+` / `rk_test_[A-Za-z0-9]+` | Stripe test |
| `pk_live_[A-Za-z0-9]+` | Stripe publishable (low risk but worth noting) |
| `sk-ant-[A-Za-z0-9_-]+` | Anthropic |
| `sk-proj-[A-Za-z0-9_-]+` / `sk-[A-Za-z0-9]{20,}` | OpenAI |
| `AIzaSy[A-Za-z0-9_-]{33}` | Google API key (Gemini, Maps, etc.) |
| `EAA[A-Za-z0-9]{50,}` | Meta / Facebook access token |
| `ghp_[A-Za-z0-9]{36}` / `github_pat_[A-Za-z0-9_]+` | GitHub PAT |
| `xox[baprs]-[A-Za-z0-9-]+` | Slack token |
| `AKIA[0-9A-Z]{16}` | AWS access key ID |
| `[A-Za-z0-9/+=]{40}` near `aws_secret` | AWS secret key |
| `glpat-[A-Za-z0-9_-]{20}` | GitLab PAT |
| `Bearer\s+[A-Za-z0-9._~+/-]+=*` | generic bearer token |
| `[A-Z][A-Z0-9_]+_(SECRET|KEY|PASSWORD|TOKEN)\s*=\s*\S+` | env-var assignments |
| `password\s*[:=]\s*['"][^'"]+['"]` | plaintext password literals |
| `-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----` | private key files |

Use a single combined regex via Grep tool:

```
sk_live_|rk_live_|sk_test_|sk-ant-|sk-proj-|AIzaSy|^EAA|EAA[A-Za-z0-9]{50}|ghp_|github_pat_|xox[baprs]-|AKIA[0-9A-Z]{16}|glpat-|BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY
```

For every match, record: file path, line number, redacted preview (first 6
chars + ellipsis).

### 2.2 Check for duplicated secrets

A key found in `.env` is expected. The same key found in a *second* location is
a finding. Common offenders, in order of how often they bite:

- `.mcp.json` — MCP server configs sometimes hardcode env vars instead of
  using `${VAR}` interpolation
- `.claude/settings.local.json` — Claude Code's permission allowlist captures
  literal command strings, so `curl ...?access_token=ABC123` becomes a
  permanent permission rule containing the token
- `output/**/*.json`, `data/**/*.jsonl` — audit logs and pipeline output that
  serialize full HTTP request/response bodies
- `*.tar.gz`, `*.zip` near the project — frozen copies that may pre-date
  rotation
- `data/**/cookies.json` — browser scraper sessions, sometimes contain
  long-lived auth cookies
- Markdown files — keys pasted into READMEs / runbooks during setup

Verify each suspected duplicate by hashing or comparing the actual string,
not just the prefix. (`AIzaSyABCDEF…` might not be the same key as
`AIzaSyABCDEG…`.)

### 2.3 Shell history and snapshots

```bash
grep -E '(AIza|sk-ant|sk_live|EAA[A-Za-z0-9]{50}|ghp_|AKIA)' /root/.bash_history /root/.zsh_history 2>/dev/null
```

If anything matches, the secret was typed on the command line and is now
permanently in shell history (and any backup that captures it). Recommend
clearing the history and rotating the affected key.

### 2.4 `.gitignore` sanity check

```bash
test -f <project>/.gitignore && cat <project>/.gitignore || echo "MISSING"
```

Required entries (or equivalent globs):
```
.env
.env.*
!.env.example
.mcp.json
.claude/settings.local.json
*.pem
*.key
*-credentials.json
node_modules/
output/
logs/
*.log
data/**/cookies.json
*.tar.gz
*.zip
```

If `.gitignore` is missing, *and* the project is a git repo, treat as Critical
even if nothing has been pushed yet — the next `git add .` could publish
everything.

---

## Phase 3 — Code surface (15 minutes)

Look for vulnerabilities in the project's own code. Five categories matter:

### 3.1 Server bindings (highest priority)

Find every server-spawning call and verify it binds to localhost only.

Patterns to search:
- `\.listen\(\d+` — Node/Express, default is `0.0.0.0` if no host given
- `http\.createServer` — same
- `http-server` invocations — defaults to `0.0.0.0`, needs `-a 127.0.0.1`
- `python.*-m\s+http\.server` — defaults to all interfaces, needs `--bind 127.0.0.1`
- `python.*HTTPServer\(\(['"]0\.0\.0\.0` — explicit public bind
- `npx serve` — defaults to all interfaces
- `app\.listen\(`, `fastify\.listen\(`, `Bun\.serve\(` — same pattern
- `host:\s*['"]0\.0\.0\.0` in config files

For each match:
- Is the host argument explicitly `127.0.0.1` / `localhost` / `::1`?
- If not, is this server *meant* to be public?
- If meant to be public, is it behind auth?

### 3.2 Command injection

Search for shell-out calls with template-string interpolation:

```
execSync\(`[^`]*\$\{
exec\(`[^`]*\$\{
spawn\(.*\$\{.*shell:\s*true
child_process.*shell.*=.*True   # Python equivalent
```

Especially dangerous when combined with:
- `ffmpeg` (paths, filter graphs)
- `powershell -ExecutionPolicy Bypass -File "${...}"`
- `bash -c "${...}"`
- Anything taking user-controlled or model-generated input

Fix: switch to `execFile` / `spawn` with an array of args (no shell), and
validate inputs.

### 3.3 Path traversal

Find file operations that take a path argument from external input without
base-directory validation:

```
fs\.(write|create|read).*Sync?\(.*(req|input|response|body|args|argv)
path\.resolve\((req|input|response|body|args|argv)
fs\.createWriteStream\(
```

Fix: resolve against an allowed base dir, then assert the result is inside it:
```javascript
const resolved = path.resolve(baseDir, userPath);
if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) {
  throw new Error('Path escape attempt');
}
```

### 3.4 Auth handling

- API tokens passed as query string `params: { access_token: ... }` instead
  of `Authorization: Bearer` headers (logged in URLs, browser history, proxy
  logs, Referer headers)
- Secrets logged via `console.log` / `JSON.stringify(error)` of full
  request/response objects
- Audit logs that capture full request bodies including auth headers — check
  the actual file contents for `EAA…` / `Bearer ` / `sk_…` patterns

### 3.5 Other

- `eval(`, `new Function(`, `vm.runInThisContext` — code injection
- Pickle, YAML.load (Python), `unserialize` (PHP) on untrusted input
- Hardcoded `http://` URLs for external APIs (should be `https://`)
- Crypto: hardcoded IVs, `Math.random()` for security purposes, `md5`/`sha1`
  for password hashing

---

## Phase 4 — Verification (only if user has rotated)

For each suspected-leaked credential, verify whether it is currently dead.
**This phase requires safe verification recipes — see the table below.**

### Stripe

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -u "$KEY:" https://api.stripe.com/v1/balance
```
- `200` → STILL LIVE
- `401 api_key_expired` → revoked
- `401 invalid_api_key` → never existed or already deleted

### Anthropic

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" \
  https://api.anthropic.com/v1/models
```
- `200` → STILL LIVE
- `401 invalid x-api-key` → revoked

### Google Gemini (AI Studio)

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY"
```
- `200` → STILL LIVE
- `400 API_KEY_INVALID` → revoked
- `403 CONSUMER_SUSPENDED` → revoked (suspended state)

### Meta / Facebook

```bash
curl -s "https://graph.facebook.com/v21.0/me?fields=id&access_token=$TOKEN"
```
- `{"id":"..."}` → STILL LIVE
- `OAuthException 190/460 "session has been invalidated"` → revoked
- `OAuthException 190` (other subcode) → may be expired rather than
  explicitly revoked; either way no longer valid

### PayPal

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -u "$CLIENT_ID:$CLIENT_SECRET" -d grant_type=client_credentials \
  https://api-m.paypal.com/v1/oauth2/token
```
- `200` with `access_token` → STILL LIVE
- `401 invalid_client` → revoked or regenerated

### OpenAI

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $KEY" https://api.openai.com/v1/models
```
- `200` → STILL LIVE
- `401` → revoked

### GitHub PAT

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" https://api.github.com/user
```
- `200` → STILL LIVE
- `401` → revoked

### Slack token

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" https://slack.com/api/auth.test
```
Response body has `ok:true` → STILL LIVE; `ok:false invalid_auth` → revoked.

### Generative-AI job queues (e.g. fal.ai) — DANGEROUS, READ THIS FIRST

**Do NOT** POST a normal-looking payload to an inference/job-queue endpoint
(e.g. `https://queue.fal.run/<model>`) — it will queue real work and bill the
user.

Safe approach (auth-checked but pre-billing rejection):

```bash
# Send invalid input that fails validation AFTER the auth check
curl -s -o /tmp/fal -w "HTTP %{http_code}\n" -X POST \
  -H "Authorization: Key $KEY" \
  -H "Content-Type: application/json" \
  -d 'this-is-not-json' \
  https://queue.fal.run/fal-ai/flux/dev
head -c 400 /tmp/fal && rm /tmp/fal
```
- `401` / `403` → revoked
- `422` / `400` JSON parse error → STILL LIVE (auth passed, payload rejected
  before billing)

If even that feels risky, ask the user to verify in the provider dashboard
("Usage" tab) and report back.

### JWT-authenticated services (e.g. Kling)

Some providers require an HS256-signed JWT built from an access/secret key pair
(typical claims `{iss: ACCESS_KEY, exp: now+1800, nbf: now-5}`). There's often
no zero-cost verification endpoint; easiest is to write a small Node/Python
helper to generate the JWT, hit any read-only endpoint, and check status.
Skip if not specifically requested — verifying after a known dashboard
revocation is low-value.

### UI-only services (no API auth check)

Services authenticated only through a web login (or via scraped browser
sessions) cannot be verified via API without logging in. Document as "manual
rotation, not API-verifiable" and move on.

### Verification report format

Maintain a single table as you go:

| # | Service | Project | Result | Evidence |
|---|---|---|---|---|

Use these result strings consistently:
- `REVOKED` (verified dead via API)
- `STILL LIVE` (verified alive)
- `NOT TESTED` (no safe API test, user must verify in dashboard)
- `NOT TESTABLE` (no API exists, e.g. UI-only password)

---

## Phase 5 — Remediation

Always confirm with the user before destructive actions. Group related fixes
into a single confirmation when possible to avoid prompt fatigue.

### Quick wins (low risk, high value)

- `chmod 600` on every secrets file found in Phase 1.4. Never `chmod 644`
  on a `.env`.
- Create or update `.gitignore` with the standard secrets-blocking entries
  from Phase 2.4.
- Edit `.mcp.json` to use `${VAR}` interpolation instead of literal keys.
  Note: env-block interpolation is well-supported for stdio MCP servers;
  header interpolation in `streamableHttp` configs may or may not expand.
  Document the uncertainty so the user can verify post-fix.
- Patch server-binding bugs found in Phase 3.1 (one-line fixes adding
  `127.0.0.1` / `-a 127.0.0.1` / `--bind 127.0.0.1`).

### Killing rogue processes (DESTRUCTIVE — confirm)

```bash
kill <PID1> <PID2> ...
sleep 1
ps -p <PID1>,<PID2>,... 2>&1
ss -tunlp | grep -E '0\.0\.0\.0:(<PORTS>)' || echo "(none — clean)"
```

After kill: probe each former port from localhost with curl to confirm it
returns connection-refused (HTTP 000).

### Enabling the host firewall (DESTRUCTIVE — confirm, and order matters)

**CRITICAL: allow port 22 BEFORE enabling, or you lock yourself out.**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw --force enable
ufw status verbose
```

### Recommending key rotation

For each STILL LIVE or potentially-leaked key, provide:
- The exact dashboard URL (or steps) for rotation
- Whether dashboard rotation auto-revokes the old key (true for most: Stripe,
  Anthropic, Gemini, OpenAI, GitHub, Slack, AWS, fal, Kling) or whether a
  separate revocation step is needed (Meta long-lived user tokens, sometimes
  PayPal — verify per-provider)
- For Stripe specifically: recommend recreating as `rk_live_` restricted with
  scoped permissions, not as another full `sk_live_`
- Order: highest blast radius first (live payment keys → email/messaging →
  generative AI → scrapers/utilities)

---

## Final report format

Always end with a single markdown report the user can save. Structure:

```markdown
# Security Audit — <project name>
**Date:** <YYYY-MM-DD>
**Host:** <public IP if known>

## Summary
<2-3 sentences: what was found, what was done, what's outstanding>

## Findings (prioritized)
| # | Severity | Category | Location | Issue | Fix |
|---|---|---|---|---|---|

## Remediation actions taken
| Action | Status |
|---|---|

## Verification results (if Phase 4 ran)
| # | Service | Project | Result | Evidence |
|---|---|---|---|---|

## Outstanding work
**Must do:** ...
**Should do:** ...
**Could do:** ...

## Lessons / process notes
<bullet points of anything learned that should inform future audits>
```

Severity guide:
- **Critical**: actively serving secrets to the internet, live credentials in
  a published location, payment-processing keys with full scope leaked
- **High**: world-readable secret files, command injection / path traversal in
  paths reachable from untrusted input, missing `.gitignore` on a git repo
- **Medium**: tokens in query strings, audit logs capturing auth headers,
  hardcoded internal IDs, unsafe verification recipes in tools
- **Low**: secrets logged at info level, weak crypto for non-security uses,
  cosmetic file-permission issues

---

## Anti-patterns to avoid

- **Don't `chmod 600` and call it done.** That stops other Unix users on the
  same machine. It does not stop a server running as the same user from
  reading and serving the file. Always pair with firewall + correct interface
  binding.

- **Don't trust `console.log("Serving on http://localhost:...")`** — many
  servers print "localhost" but actually bind `0.0.0.0`. Verify with `ss`,
  not the application's own log line.

- **Don't run verification curls that queue real work.** Always design the
  verification request to fail before billing. When in doubt, ask the user
  to verify in the provider dashboard instead.

- **Don't kill root processes without confirming with the user first.** Even
  if they look clearly bad, they might be load-bearing for something the user
  hasn't told you about. Show the PIDs, the cwd, the cmdline, and ask.

- **Don't claim a project is safe based on one phase.** Secrets can be correctly
  stored in `.env` (passing Phase 2) while a dev server in the project root
  serves that same `.env` to the public internet (failing Phase 1). Both phases
  matter — clear results in one are not evidence about the others.

- **Don't recommend "rotate everything" as a substitute for understanding
  what leaked.** Rotation is the right move when something *did* leak, but
  the audit's job is to figure out what actually happened — which keys are
  still live, where they were exposed, and for how long.
