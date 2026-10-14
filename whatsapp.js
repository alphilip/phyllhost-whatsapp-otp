// PhyllHost WhatsApp OTP Service — Baileys Connection Layer.
//
// Features:
// - One linked WhatsApp number.
// - Outbound OTP message delivery.
// - No automatic replies to incoming messages.
// - Persistent WhatsApp session.
// - Automatic reconnection.
// - QR-code linking.
// - Phyllhost profile-name update.
//
// Session persists at /data/whatsapp-session.

import { mkdir, rm } from "node:fs/promises";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys";

import P from "pino";
import QRCode from "qrcode";

const SESSION_DIR = "/data/whatsapp-session";
const PROFILE_NAME = "Phyllhost";

let sock = null;
let currentQR = null;
let connectionStatus = "disconnected";
let connectedNumber = null;
let isStarting = false;

// Prevent an outdated reconnection timer from starting a duplicate socket.
let connectEpoch = 0;

/* =========================================
   CLEAR WHATSAPP SESSION
========================================= */

async function clearSession() {
  sock = null;
  currentQR = null;
  connectionStatus = "disconnected";
  connectedNumber = null;

  try {
    await rm(SESSION_DIR, {
      recursive: true,
      force: true
    });
  } catch (error) {
    console.error(
      "Failed to clear WhatsApp session:",
      error.message
    );
  }

  try {
    await mkdir(SESSION_DIR, {
      recursive: true
    });
  } catch (error) {
    console.error(
      "Failed to recreate session directory:",
      error.message
    );
  }
}

/* =========================================
   START WHATSAPP CONNECTION
========================================= */

async function startWhatsApp() {
  if (isStarting) {
    console.log("WhatsApp startup already in progress.");
    return;
  }

  isStarting = true;

  try {
    await mkdir(SESSION_DIR, {
      recursive: true
    });

    const { state, saveCreds } =
      await useMultiFileAuthState(SESSION_DIR);

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: P({ level: "silent" }),
      browser: ["PhyllHost OTP", "Chrome", "1.0.0"]
    });

    sock = socket;

    socket.ev.on("creds.update", saveCreds);

    // Incoming messages are deliberately ignored.
    // This service does not implement a chatbot or auto-replies.

    socket.ev.on("connection.update", async (update) => {
      // Ignore events from a socket that is no longer active.
      if (sock !== socket) return;

      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      /* -------------------------
         QR CODE
      ------------------------- */

      if (qr) {
        connectionStatus = "qr";
        currentQR = await QRCode.toDataURL(qr);

        console.log(
          "WhatsApp OTP: QR code generated."
        );
      }

      /* -------------------------
         CONNECTED
      ------------------------- */

      if (connection === "open") {
        connectionStatus = "connected";
        currentQR = null;

        if (socket.user?.id) {
          connectedNumber =
            socket.user.id.split(":")[0];
        }

        console.log("WhatsApp OTP: connected.");
        console.log("Number:", connectedNumber);

        // Attempt to update the WhatsApp profile name.
        try {
          await socket.updateProfileName(PROFILE_NAME);

          console.log(
            `WhatsApp profile name updated to ${PROFILE_NAME}.`
          );
        } catch (error) {
          console.error(
            "Could not update WhatsApp profile name:",
            error.message
          );

          console.log(
            "You can also set the profile name in WhatsApp settings."
          );
        }
      }

      /* -------------------------
         CONNECTION CLOSED
      ------------------------- */

      if (connection === "close") {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        currentQR = null;
        connectedNumber = null;
        connectionStatus = "disconnected";

        console.log(
          "WhatsApp OTP: connection closed."
        );

        // Logged out: clear the invalid session and
        // generate a new QR code.
        if (
          statusCode === DisconnectReason.loggedOut
        ) {
          console.log(
            "WhatsApp OTP: logged out. Clearing session."
          );

          await clearSession();
          scheduleRestart(1000);
          return;
        }

        console.log(
          "WhatsApp OTP: attempting reconnection."
        );

        scheduleRestart(3000);
      }
    });

  } catch (error) {
    console.error(
      "Failed to start WhatsApp:",
      error.message
    );

    connectionStatus = "disconnected";

    scheduleRestart(5000);

  } finally {
    isStarting = false;
  }
}

/* =========================================
   AUTOMATIC RECONNECTION
========================================= */

function scheduleRestart(ms) {
  const epoch = connectEpoch;

  setTimeout(() => {
    if (epoch !== connectEpoch) {
      return;
    }

    startWhatsApp().catch((error) => {
      console.error(
        "Scheduled WhatsApp restart failed:",
        error.message
      );
    });
  }, ms);
}

/* =========================================
   MANUAL RELINK
========================================= */

async function relink() {
  connectEpoch++;

  const oldSocket = sock;

  sock = null;
  currentQR = null;
  connectionStatus = "disconnected";
  connectedNumber = null;

  if (oldSocket) {
    try {
      oldSocket.ev.removeAllListeners();

      await oldSocket.end(
        new Error("Manual relink requested")
      );
    } catch (error) {
      console.error(
        "Relink socket teardown:",
        error.message
      );
    }
  }

  await clearSession();

  startWhatsApp().catch((error) => {
    console.error(
      "Failed to restart WhatsApp after relink:",
      error.message
    );
  });
}

/* =========================================
   GET CONNECTION STATUS
========================================= */

function getStatus() {
  return {
    status: connectionStatus,
    number: connectedNumber,
    qr: currentQR,
    profileName: PROFILE_NAME
  };
}

/* =========================================
   SEND MESSAGE
========================================= */

async function sendMessage(phone, message) {
  if (!sock || connectionStatus !== "connected") {
    throw new Error("WhatsApp is not connected.");
  }

  if (!phone || !message) {
    throw new Error(
      "Phone number and message are required."
    );
  }

  const normalizedPhone = String(phone).replace(
    /\D/g,
    ""
  );

  if (!normalizedPhone) {
    throw new Error(
      "A valid phone number is required."
    );
  }

  const jid =
    normalizedPhone + "@s.whatsapp.net";

  const result = await sock.sendMessage(jid, {
    text: String(message)
  });

  return result;
}

/* =========================================
   LOGOUT / DISCONNECT
========================================= */

async function logout() {
  connectEpoch++;

  const oldSocket = sock;

  sock = null;
  connectionStatus = "disconnected";
  currentQR = null;
  connectedNumber = null;

  if (oldSocket) {
    try {
      oldSocket.ev.removeAllListeners();
      await oldSocket.logout();
    } catch (error) {
      console.error(
        "WhatsApp logout error:",
        error.message
      );
    }
  }

  await clearSession();

  // Start a new linking attempt so the dashboard
  // can display a fresh QR code.
  startWhatsApp().catch((error) => {
    console.error(
      "Failed to restart WhatsApp after logout:",
      error.message
    );
  });
}

/* =========================================
   EXPORT FUNCTIONS
========================================= */

export {
  startWhatsApp,
  getStatus,
  sendMessage,
  logout,
  relink
};
