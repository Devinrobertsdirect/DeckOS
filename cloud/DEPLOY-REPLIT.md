# Deploy Nobi Cloud to Replit

Nobi Cloud is the online-mode backend: accounts, login, the encrypted API-key
vault, the per-account profile (AI-setup sync), the cloud brain, and the bot
relay. One deploy serves all of it (and, optionally, the mobile web app).

## 1. Get the code into a Repl

**Recommended — its own Repl:** create a new Node.js Repl and put the contents of
this `cloud/` folder at its root (so `package.json` and `.replit` are top-level).
The included `.replit` is already configured.

## 2. Set Secrets (Replit → Tools → Secrets)

| Secret | Required | Value |
|---|---|---|
| `NEURA_VAULT_KEY` | **Yes** | 64 hex chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Never changes** once set — changing it orphans every stored API key. |
| `GOOGLE_CLIENT_ID` | For Google login | Google Cloud → Credentials → OAuth 2.0 Client ID. |
| `NEURA_WS_ORIGINS` | Optional | Comma-separated browser origins allowed to open the relay WebSocket. Native/Expo apps send no Origin and are always allowed. |

Do **not** put `NEURA_VAULT_KEY` in `.replit` or any committed file — Secrets only.

## 3. Deploy as a **Reserved VM** (important)

In the Deployments panel, choose **Reserved VM** — *not* Autoscale. Nobi Cloud is
stateful:
- It holds **open WebSocket relay connections** (bots stay connected). Autoscale
  runs multiple instances and scales to zero, which breaks the relay.
- It persists **`db.json`** (accounts, vault, profiles) to the local disk, which
  a Reserved VM keeps across restarts. Autoscale/Cloud Run filesystems are
  ephemeral — data would vanish on redeploy.

The `.replit` build/run commands are already set:
- build: `npm install --include=dev && npm run build`
- run: `node dist/index.mjs`

The app listens on `process.env.PORT` (Replit provides it) → mapped to `:80`.

## 4. Verify

Open the deploy URL — you'll see the Nobi Cloud status page. Then:
```
curl https://<your-repl>.replit.app/v1/health
# → {"ok":true,"service":"neura-cloud","vaultKey":true,"google":true|false}
```
`vaultKey:true` confirms `NEURA_VAULT_KEY` is set. Then point the Expo app's
`NEURA_APP_URL` at this deploy (see the mobile app's README).

## 5. (Optional) Serve the mobile web app from the same Repl

Drop the built mobile web app into `./mobile-dist/` (an `index.html` + assets),
or set `NEURA_MOBILE_DIST` to its path. Nobi Cloud then serves it at `/mobile/`,
so one URL provides the API **and** the mobile UI, and the Expo app can point at
`https://<your-repl>.replit.app/mobile/`.

## Persistence note
`db.json` lives at `./.neura-cloud/db.json` (override with `NEURA_DATA_DIR`). On a
Reserved VM this persists. For multi-instance scale later, implement the `Store`
interface against Postgres (Replit has a Postgres add-on) — every route already
goes through that interface, so no route changes are needed.

## Security
See [`SECURITY.md`](./SECURITY.md) for the full hardening summary and the
required production posture.
