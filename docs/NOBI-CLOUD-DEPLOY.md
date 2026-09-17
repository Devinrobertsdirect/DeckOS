# Nobi Cloud — Deploy & Replit Setup

**Nobi Cloud** is the small backend that makes the native mobile app work away from
home. It provides:

- **Accounts** — email/password + Google sign-in, persistent across all your devices.
- **Encrypted API-key vault** — each account stores its own provider keys (Anthropic,
  etc.), AES-256-GCM encrypted at rest. Nobi Cloud never shares keys between users.
- **Cloud brain** — `POST /v1/chat` runs the AI on *your* stored key, so the app works
  even when your desktop is off.
- **Bot relay** — your Pi/desktop bot dials *out* to the cloud and holds a socket open,
  so your phone can reach it from anywhere with no port-forwarding.

It's a single Node process. It runs on Replit with **zero database setup** (v1 uses a
durable JSON store on the Replit filesystem; swapping in Postgres later is a drop-in
behind the `Store` interface in `cloud/src/store.ts`).

---

## 1. Environment variables

| Variable | Required | What it is |
|---|---|---|
| `NEURA_VAULT_KEY` | **Yes** | Master secret that encrypts every stored API key. Use a strong random value. **Back it up** — if you lose it, stored keys become unrecoverable by design. |
| `PORT` | No (Replit sets it) | Port to listen on. Defaults to `8790`. |
| `GOOGLE_CLIENT_ID` | Only for Google login | OAuth **Web** client ID from Google Cloud (see §4). |
| `NEURA_CLOUD_MODEL` | No | Claude model id for the cloud brain. Defaults to `claude-3-5-sonnet-latest`. |
| `NEURA_CLOUD_MAX_TOKENS` | No | Max response tokens. Defaults to `1024`. |
| `NEURA_DATA_DIR` | No | Where the JSON store lives. Defaults to `./.neura-cloud`. On Replit, point this at a persistent path if needed. |

Generate a vault key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Build & run

```bash
pnpm install
pnpm --filter @workspace/neura-cloud build     # → cloud/dist/index.mjs
node cloud/dist/index.mjs                       # starts HTTP + WebSocket on $PORT
```

Health check: `GET /v1/health` → `{ "ok": true, "service": "neura-cloud", "vaultKey": true }`.
If `vaultKey` is `false`, `NEURA_VAULT_KEY` isn't set and key-vault writes will fail.

---

## 3. Message to send Replit

> Please deploy the `@workspace/neura-cloud` package as an always-on Node service.
> Build command: `pnpm install && pnpm --filter @workspace/neura-cloud build`.
> Run command: `node cloud/dist/index.mjs`.
> Set these Secrets: `NEURA_VAULT_KEY` = (the 64-char hex I'll paste), and later
> `GOOGLE_CLIENT_ID` for Google login. Expose it on HTTPS and give me the public URL —
> that URL is what the mobile app points at in online mode. Keep the filesystem
> persistent so `.neura-cloud/db.json` (accounts + encrypted keys) survives restarts.

---

## 4. Google sign-in (optional)

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID**.
2. Application type: **Web application** (the mobile app sends the Google **ID token**;
   the cloud verifies its `aud` against this client ID).
3. Add authorized origins for your app + the cloud URL.
4. Copy the **Client ID** into the `GOOGLE_CLIENT_ID` secret and redeploy.
5. Put the same client ID in the mobile app config (`interfaces/mobile` — Google button).

Without `GOOGLE_CLIENT_ID`, email/password still works and the app hides the Google button.

---

## 5. Connecting a bot (Pi / desktop) to the cloud

1. In the app (signed in) → **Bots → Link a bot** → the app calls `POST /v1/bots/link`
   and shows a one-time **link token**.
2. On the bot, run the relay client with that token. It connects out to:
   `wss://<your-cloud-url>/v1/ws?role=bot&linkToken=<token>` and answers commands.
3. The bot now shows **online** in the app, and phone commands route to it.

(The bot-side relay client ships next; the protocol is documented in `cloud/src/relay.ts`.)

---

## 6. API reference (all JSON, base `/v1`)

| Method | Path | Auth | Body → Result |
|---|---|---|---|
| GET | `/health` | — | service status |
| GET | `/config` | — | which features are enabled |
| POST | `/auth/signup` | — | `{email,password}` → `{token,user}` |
| POST | `/auth/login` | — | `{email,password}` → `{token,user}` |
| POST | `/auth/google` | — | `{idToken}` → `{token,user}` |
| POST | `/auth/logout` | Bearer | → `{ok}` |
| GET | `/auth/me` | Bearer | → `{user}` |
| GET | `/keys` | Bearer | → `{keys:[{name,hasValue,updatedAt}]}` (never values) |
| PUT | `/keys/:name` | Bearer | `{value}` → `{ok}` (encrypted) |
| DELETE | `/keys/:name` | Bearer | → `{ok}` |
| POST | `/chat` | Bearer | `{message,history?}` → `{reply,model}` |
| POST | `/bots/link` | Bearer | `{name}` → `{botId,linkToken}` (once) |
| GET | `/bots` | Bearer | → `{bots:[{id,name,online,lastSeen}]}` |
| POST | `/bots/:id/command` | Bearer | `{type,payload}` → `{ok,requestId,result}` |
| WS | `/ws?role=phone&token=…` | — | phone event stream |
| WS | `/ws?role=bot&linkToken=…` | — | bot command channel |

---

## 7. Security notes

- **Passwords**: scrypt-hashed with a per-user salt; never stored or logged in plaintext.
- **Sessions**: opaque random bearer tokens; only their SHA-256 is stored, so a store
  leak can't be replayed. 60-day expiry.
- **Key vault**: AES-256-GCM (authenticated) under `NEURA_VAULT_KEY`. Values are never
  returned by the API and never written to disk in plaintext (verified).
- **Transport**: run behind Replit's HTTPS. Never expose this on plain HTTP in production.
- **Rotating the vault key**: re-encrypting existing keys requires the old value; keep a
  backup. Changing it invalidates all stored keys (users just re-enter them).
