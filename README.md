# PhyllHost WhatsApp notification service

Single-channel WhatsApp service for the PhyllHost platform. One linked
WhatsApp number sends ALL outbound platform notifications: OTP codes
(registration verification, password reset) AND every other platform
message (welcome, payment received, plan expiring/expired, trial
started/expiring, site deployed/suspended/deleted, backup completed,
password changed, mailbox ready, affiliate earning, support ticket
reply). It **never replies** to incoming messages.

Separate from THE DM SHOP bot (which lives on `wa.phyllhost.com`) so a
shop-bot problem can never block platform logins or notifications.

The bot code did not change for this role: `POST /send` already accepts
arbitrary `{ phone, message }`, so the platform routes every
notification kind through the same endpoint. Only the message types
widened — the bot stays one-way, no shop logic, no replies.

## Files

- `server.js` — Express dashboard + API (`/status`, `/send`,
  `/disconnect`, `/relink`, `/health`)
- `whatsapp.js` — Baileys connection, QR, send, relink, logout
- `Dockerfile` — Coolify build
- `.env.example` — the only variables this service needs

## Run

```sh
npm install
ADMIN_TOKEN=<your-token> node server.js
```

Then open `http://localhost:3000`, enter the token, scan the QR.

## Deploy

See `DEPLOY-GUIDE.md` (browser-only: GitHub → Coolify, domain
`otp.phyllhost.com`, persistent volume at `/data/whatsapp-session`).

## Notes

- Baileys is unofficial WhatsApp Web automation: use a **dedicated**
  number for platform notifications. If it gets restricted, no one can
  log in and no notifications go out until a replacement is linked.
- The PhyllHost Worker calls this service with its own server-side
  token (`WHATSAPP_ADMIN_TOKEN`). The token never goes in browser code.
