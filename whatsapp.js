// PhyllHost WhatsApp OTP service — Baileys connection layer.
//
// OTP-ONLY by design: this service links one WhatsApp number and sends
// outbound OTP codes. It NEVER replies to incoming messages — every
// incoming message is ignored. There is no bot, no menus, no Sheets,
// no payments. One job: keep the number connected and deliver /send.
//
// Session persists at /data/whatsapp-session (Coolify persistent volume)
// so restarts don't need a re-scan.

import { mkdir, rm } from "node:fs/promises";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import P from "pino";
import QRCode from "qrcode";

const SESSION_DIR = "/data/whatsapp-session";

let sock = null;
let currentQR = null;
let connectionStatus = "disconnected";
let connectedNumber = null;

// Bumps on every manual relink/logout so a stale auto-restart timer
// from an older connection attempt can never spawn a duplicate socket.
let connectEpoch = 0;

// Wipe local state + session files so the next start
// begins clean and WhatsApp issues a fresh QR code.
async function clearSession() {
  sock = null;
  currentQR = null;
  connectionStatus = "disconnected";
  connectedNumber = null;

  try {
    await rm(SESSION_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error("Failed to clear WhatsApp session:", error.message);
  }

  try {
    await mkdir(SESSION_DIR, { recursive: true });
  } catch (error) {
    console.error("Failed to recreate session dir:", error.message);
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    browser: ["PhyllHost OTP", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // OTP service: incoming messages are deliberately ignored.
  // No auto-replies, no menus, no forwarding.

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = "qr";
      currentQR = await QRCode.toDataURL(qr);
      console.log("WhatsApp OTP: QR code generated.");
    }

    if (connection === "open") {
      connectionStatus = "connected";
      currentQR = null;

      if (sock.user?.id) {
        connectedNumber = sock.user.id.split(":")[0];
      }

      console.log("WhatsApp OTP: connected.");
      console.log("Number:", connectedNumber);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      // Logged out (from phone or via /disconnect): old creds are
      // dead, so wipe them and start over to get a fresh QR.
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("WhatsApp OTP: logged out. Clearing session for a fresh QR...");
        await clearSession();
        scheduleRestart(1000);
        return;
      }

      connectionStatus = "disconnected";
      currentQR = null;
      console.log("WhatsApp OTP: disconnected. Reconnecting...");

      scheduleRestart(3000);
    }
  });
}

// Restart after `ms`, unless a manual relink/logout happened first.
function scheduleRestart(ms) {
  const epoch = connectEpoch;
  setTimeout(() => {
    if (epoch !== connectEpoch) return; // superseded by relink/logout
    startWhatsApp().catch((error) => {
      console.error("Scheduled WhatsApp OTP restart failed:", error.message);
    });
  }, ms);
}

// Force a brand-new link attempt: tear down the current socket (if any),
// wipe the session, and start over so WhatsApp issues a fresh QR code.
// Safe to call in any state — including when a link attempt failed,
// the QR expired, or the dashboard is stuck on "disconnected".
async function relink() {
  connectEpoch++; // invalidate any pending auto-restart

  if (sock) {
    try {
      // Stop the old socket's close-handler from firing a restart.
      sock.ev.removeAllListeners();
      await sock.end(new Error("Manual relink requested"));
    } catch (error) {
      console.error("Relink socket teardown:", error.message);
    }
  }

  await clearSession();

  startWhatsApp().catch((error) => {
    console.error("Failed to restart WhatsApp OTP after relink:", error);
  });
}

function getStatus() {
  return {
    status: connectionStatus,
    number: connectedNumber,
    qr: currentQR
  };
}

async function sendMessage(phone, message) {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp is not connected.");
  }

  const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";

  const result = await sock.sendMessage(jid, {
    text: message
  });

  return result;
}

async function logout() {
  connectEpoch++; // invalidate any pending auto-restart

  if (sock) {
    try {
      // Stop the close-handler from also firing a restart.
      sock.ev.removeAllListeners();
      await sock.logout();
    } catch (error) {
      console.error("Logout error:", error.message);
    }
  }

  await clearSession();

  // Start over immediately so the dashboard shows a fresh QR.
  startWhatsApp().catch((error) => {
    console.error("Failed to restart WhatsApp OTP after logout:", error);
  });
}

export {
  startWhatsApp,
  getStatus,
  sendMessage,
  logout,
  relink
};
