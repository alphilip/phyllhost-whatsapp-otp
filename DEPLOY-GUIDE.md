# PhyllHost WhatsApp notification service — deploy guide (browser only)

Single-channel service: one linked WhatsApp number that sends ALL
PhyllHost platform notifications — OTP codes (registration, password
reset) plus every other platform message (welcome, payments, plan/trial
expiry, site events, backups, password changes, mailbox ready,
affiliate earnings, ticket replies). It never replies to incoming
messages. Separate from the shop bot.

## What you need

- The zip: `phyllhost-whatsapp-otp.zip` (server.js, whatsapp.js,
  package.json, Dockerfile, .env.example, this guide)
- A **new** admin token for THIS service (generate one — must differ
  from the shop bot's token). Save it somewhere safe: you will paste
  the same value into the PhyllHost Worker secret `WHATSAPP_ADMIN_TOKEN`.
- A domain for it: `otp.phyllhost.com`

## 1. DNS

In Cloudflare → your zone → DNS → Add record:

- Type: **A**
- Name: **otp**
- IPv4 address: **84.8.217.243** (the Oracle Coolify instance — the old
  AWS box 16.192.78.91 is dead; updated Oct 20)
- Proxy status: **DNS only** (grey cloud — the service is not behind the
  proxy, same as the shop bot)

## 2. GitHub

1. Create a **new private** repo, e.g. `phyllhost-whatsapp-otp`.
2. Extract the zip on your computer.
3. Upload the extracted files (server.js, whatsapp.js, package.json,
   Dockerfile, .dockerignore, .env.example) to the repo.
4. Commit directly to `main`.

## 3. Coolify — new app

1. Coolify → **+ New Resource** → **GitHub** → pick the new repo →
   branch `main`.
2. Port: **3000**.
3. **Persistent volume**: add a volume mounted at
   `/data/whatsapp-session` so the QR login survives restarts.
4. Environment variables:
   - `ADMIN_TOKEN` = the new token from above (Secret)
   - `PORT` = `3000`
   - `PUBLIC_BASE_URL` = `https://otp.phyllhost.com`
5. Domain: set the app's domain to `https://otp.phyllhost.com`.
6. **Deploy.**

## 4. Link the number

1. Open `https://otp.phyllhost.com`.
2. Enter the new token → **Continue** (click the button — or press Enter).
3. Scan the QR with WhatsApp → Linked Devices → Link a Device.
4. The dashboard should show **Connected** + the number.

Keep this number **dedicated** to platform notifications. If WhatsApp ever
restricts it, no one can log in and no notifications go out until you
link a replacement — so don't use your personal number here, and don't
run the shop bot or bulk messages on it.

## 5. Point the platform at it

In Cloudflare → Workers & Pages → `phyllhost-api` → Settings →
Variables and Secrets:

- Text variable: `WHATSAPP_API_URL` = `https://otp.phyllhost.com`
- Secret: `WHATSAPP_ADMIN_TOKEN` = the same new token from step 3

Then **Redeploy** the Worker. (Saving variables alone does not update
the running deployment.)

## 6. Test

1. Register a fresh account on `phyllhost.com` with a WhatsApp number.
2. The 6-digit code should arrive on WhatsApp within a minute.
3. Verify the account with that code.
4. Test password reset the same way.

## API (for the Worker)

All calls use `Authorization: Bearer <ADMIN_TOKEN>`.

- `GET /status` — `{ status, number, qr }`
- `POST /send` — body `{ phone, message }` → `{ success, messageId }`
- `POST /disconnect` — logs out and shows a fresh QR
- `POST /relink` — forces a fresh QR (use if the QR expired or the
  dashboard is stuck)
- `GET /health` — no auth: `{ ok, buildId, whatsapp, service: "otp" }`

## If the QR won't show or login fails

- "Unauthorized" (401) → the token typed doesn't match the Coolify
  `ADMIN_TOKEN` (check for pasted whitespace).
- Dashboard stuck on "Not connected yet" → press **Get a new QR code**
  (calls /relink).
- After a Coolify redeploy, check the footer: it should read
  `build 2026-10-14a`. If it doesn't, the deploy didn't pick up the
  new code.
