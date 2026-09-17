# Nobi Cloud — Security posture

Nobi Cloud is the multi-tenant backend that holds accounts, an **encrypted
per-account API-key vault**, and the **bot relay hub**. Because it can hold users'
provider keys and command their robots, it went through an adversarial security
review (20 confirmed findings). This documents the hardening and the production
requirements.

## Required production secrets (set these on Replit / your host)

| Env var | Required | Notes |
|---|---|---|
| `NEURA_VAULT_KEY` | **Yes** | Master key for the API-key vault. **Must be high-entropy** — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (64 hex chars). A weak/short value is rejected (`< 32` chars) and would be brute-forceable if the DB ever leaked. **Never commit it.** |
| `GOOGLE_CLIENT_ID` | For Google login | From Google Cloud → Credentials → OAuth 2.0 Client ID. Google login is disabled if unset. |
| `NEURA_DATA_DIR` | Optional | Where `db.json` is persisted (default `./.neura-cloud`). Put it on a persistent volume. |
| `NEURA_WS_ORIGINS` | Optional | Comma-separated browser origins allowed to open the relay WebSocket. Native apps send no `Origin` and are always allowed. Set this if you also use the web app cross-origin. |
| `NEURA_CLOUD_MODEL` | Optional | Cloud-brain model (default `claude-3-5-sonnet-latest`). |
| `NEURA_CLOUD_AUTH_PER_MIN` / `_CHAT_PER_MIN` / `_CMD_PER_MIN` | Optional | Rate-limit tuning (defaults 20 / 20 / 60). |

> `NEURA_VAULT_KEY` **must be stable** — if it changes, previously stored keys can't be decrypted and users must re-enter them.

## What the review found and how it's addressed

**Critical**
- **Google `email_verified` bypass → account takeover.** The `/auth/google` handler now rejects any token where `email_verified !== true`, and validates `iss` (issuer) and `aud` (audience). Email-based linking to an existing password account only happens after that check, so a token asserting a victim's unverified email can't hijack their account.

**High**
- **Blocking password hashing (event-loop DoS).** `scryptSync` → async `scrypt` (offloaded to the libuv pool) so hashing never stalls the process.
- **No rate limiting.** IP-throttle on all `/v1/auth/*` routes; per-account throttles on `/v1/chat` and `/v1/bots/*`.
- **Chat cost-amplification.** `/v1/chat` is rate-limited per account and the aggregate prompt size is capped (not just per message), so a token-holder can't drain their own provider credits at machine speed.
- **Synchronous whole-DB writes per request.** Persistence is now async + atomic (temp-file + rename) and serialized; high-frequency "last seen" touches are debounced instead of rewriting the file every request. Sessions are capped per account and expired ones are purged hourly.
- **Relay WS ignored session expiry.** The phone WebSocket now uses the **same** session validator as REST (TTL + account-existence), so an expired token can't open a relay socket.

**Medium**
- **Login timing oracle (account enumeration).** Login always runs exactly one scrypt verify (against a dummy hash when the account is missing or Google-only), so response time can't reveal which emails exist.
- **Weak vault-key derivation.** `NEURA_VAULT_KEY` is length-validated (≥32) and documented to be 32 random bytes; the header comment no longer implies a short passphrase is fine.
- **Secrets in the WS URL.** Credentials now travel in the `Sec-WebSocket-Protocol` header (`neura.v1.<token>`), so they don't land in proxy access logs. A `?token=` query is still accepted as a fallback.
- **Permanent, non-revocable bot tokens.** Added `POST /v1/bots/:id/relink` (rotate) and `DELETE /v1/bots/:id` (revoke).
- **WS resource exhaustion.** 64 KB `maxPayload`, per-account socket cap, per-account in-flight-command cap, command-payload size cap, optional origin allowlist.

**Low**
- AES-GCM vault blobs are **AAD-bound** to `(accountId, name)` so a ciphertext can't be relocated between slots/accounts.
- Bearer scheme parsed case-insensitively (RFC 6750).
- `idToken` length-bounded; Google errors return a generic `502` instead of raw internal text.

## Standing hardening notes (future)
- For multi-instance deployment, move the rate-limiter and session store to Redis/Postgres (the `Store` interface already abstracts persistence).
- Consider email verification on signup to fully close signup-based enumeration (currently mitigated by rate limiting).
- Prefer local Google JWT signature verification (`google-auth-library`) over the tokeninfo endpoint to cut an outbound call.
