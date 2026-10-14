// PhyllHost WhatsApp OTP service — dashboard + API.
//
// OTP-ONLY: this service links one WhatsApp number and sends outbound
// OTP codes for the PhyllHost platform. It never replies to incoming
// messages. The platform Worker calls /send with its own server-side
// token; the dashboard here is for linking the number and testing.

import express from "express";

import {
  startWhatsApp,
  getStatus,
  sendMessage,
  logout,
  relink
} from "./whatsapp.js";

const app = express();

const PORT = process.env.PORT || 3000;
// Trimmed: pasting a token into Coolify often adds invisible whitespace,
// which would otherwise make every login fail with no useful message.
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();
const BUILD_ID = "2026-10-14a";

app.use(express.json());

/* =========================
   AUTHENTICATION
========================= */

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!ADMIN_TOKEN) {
    return res.status(500).json({
      success: false,
      error: "ADMIN_TOKEN is not configured."
    });
  }

  if (authHeader !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized."
    });
  }

  next();
}

/* =========================
   HOME — dashboard
========================= */

app.get("/", async (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PhyllHost WhatsApp OTP</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f4f6f8;
      color: #222;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 500px;
      background: white;
      padding: 35px;
      border-radius: 18px;
      box-shadow: 0 10px 35px rgba(0,0,0,0.08);
      text-align: center;
      margin: 20px;
    }
    h1 { margin-bottom: 10px; }
    .subtitle { color: #777; margin-bottom: 30px; }
    .login input {
      width: 100%;
      padding: 13px;
      margin-bottom: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 15px;
    }
    button {
      border: none;
      padding: 13px 20px;
      margin: 6px;
      border-radius: 8px;
      cursor: pointer;
      background: #111;
      color: white;
      font-size: 15px;
    }
    button:hover { opacity: 0.85; }
    .danger { background: #c62828; }
    .status {
      padding: 15px;
      border-radius: 10px;
      background: #fff7d6;
      margin-bottom: 20px;
    }
    .connected { background: #dff7e5; color: #146c2e; }
    .qr { width: 280px; max-width: 100%; margin: 20px auto; display: block; }
    .number { font-size: 18px; margin-bottom: 25px; }
    #dashboard { display: none; }
    #error { color: #c62828; margin-top: 10px; }
  </style>
</head>
<body>
<div class="container">
  <h1>PhyllHost WhatsApp OTP</h1>
  <div class="subtitle">OTP sending service — one linked number, no replies</div>

  <!-- LOGIN -->
  <div id="login">
    <div class="login">
      <input type="password" id="token" placeholder="Enter admin token">
      <button onclick="login()">Continue</button>
      <div id="error"></div>
    </div>
  </div>

  <!-- DASHBOARD -->
  <div id="dashboard">
    <div id="content">Loading...</div>
  </div>

  <div style="margin-top:25px;font-size:12px;color:#aaa;">
    build ${BUILD_ID}
  </div>
</div>

<script>
let adminToken = "";

// Let the Enter key submit the token too (the input is not in a
// <form>, so without this pressing Enter silently does nothing).
document.getElementById("token").addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter") {
      login();
    }
  }
);

/* =========================
   LOGIN
========================= */

async function login() {
  const errorBox = document.getElementById("error");
  const token = document.getElementById("token").value.trim();

  if (!token) {
    errorBox.textContent = "Please enter your admin token.";
    return;
  }

  errorBox.textContent = "Verifying...";

  let response;
  try {
    response = await fetch("/status", {
      headers: { "Authorization": "Bearer " + token }
    });
  } catch (err) {
    errorBox.textContent =
      "Could not reach the server. Check your connection and try again.";
    return;
  }

  if (!response.ok) {
    let message = "Invalid admin token.";
    try {
      const data = await response.json();
      if (data && data.error) {
        message = data.error;
      }
    } catch (err) {
      // keep the default message
    }
    errorBox.textContent = message + " (HTTP " + response.status + ")";
    return;
  }

  errorBox.textContent = "";
  adminToken = token;
  document.getElementById("login").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  loadStatus();

  // Keep the QR fresh: re-check every 20 seconds while the dashboard
  // is open, so an expired QR is replaced automatically.
  setInterval(() => {
    loadStatus().catch(() => {});
  }, 20000);
}

/* =========================
   LOAD STATUS
========================= */

async function loadStatus() {
  let response;
  try {
    response = await fetch("/status", {
      headers: { "Authorization": "Bearer " + adminToken }
    });
  } catch (err) {
    return;
  }

  const data = await response.json();
  const content = document.getElementById("content");

  if (data.status === "connected") {
    content.innerHTML = \`
      <div class="status connected">Connected</div>
      <div class="number">+\${data.number}</div>
      <p>This number sends PhyllHost OTP codes. It never replies to incoming messages.</p>
      <button onclick="sendTest()">Send test OTP</button>
      <button onclick="relink()">Get a new QR code</button>
      <button class="danger" onclick="disconnect()">Disconnect</button>
    \`;
    return;
  }

  if (data.qr) {
    content.innerHTML = \`
      <div class="status">Scan this code with WhatsApp</div>
      <img class="qr" src="\${data.qr}">
      <p>WhatsApp &rarr; Linked Devices &rarr; Link a Device</p>
      <button onclick="relink()">Get a new QR code</button>
    \`;
    return;
  }

  content.innerHTML = \`
    <div class="status">Not connected yet</div>
    <p>Waiting for a QR code...</p>
    <button onclick="relink()">Get a new QR code</button>
  \`;
}

/* =========================
   ACTIONS
========================= */

async function sendTest() {
  const phone = prompt("Enter the WhatsApp number including country code:");
  if (!phone) return;
  const message = "PhyllHost test: OTP codes are sending from this number.";

  const response = await fetch("/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + adminToken
    },
    body: JSON.stringify({ phone, message })
  });

  const result = await response.json();
  alert(result.message || result.error);
  loadStatus();
}

async function disconnect() {
  if (!confirm("Disconnect this WhatsApp number from the OTP service?")) return;

  const response = await fetch("/disconnect", {
    method: "POST",
    headers: { "Authorization": "Bearer " + adminToken }
  });

  const result = await response.json();
  alert(result.message || result.error);
  loadStatus();
}

async function relink() {
  const response = await fetch("/relink", {
    method: "POST",
    headers: { "Authorization": "Bearer " + adminToken }
  });

  const result = await response.json();
  alert(result.message || result.error);
  loadStatus();
}
</script>
</body>
</html>
  `);
});

/* =========================
   STATUS API
========================= */

app.get("/status", requireAuth, async (req, res) => {
  try {
    const data = await getStatus();
    res.json(data);
  } catch (error) {
    console.error("Status error:", error);
    res.status(500).json({
      success: false,
      error: "Could not get WhatsApp status."
    });
  }
});

/* =========================
   SEND MESSAGE
========================= */

app.post("/send", requireAuth, async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: "Phone number and message are required."
      });
    }

    const result = await sendMessage(phone, message);

    res.json({
      success: true,
      messageId: result?.key?.id || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================
   DISCONNECT
========================= */

app.post("/disconnect", requireAuth, async (req, res) => {
  try {
    await logout();
    res.json({
      success: true,
      message: "WhatsApp disconnected."
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================
   RELINK (force a fresh QR code)
   Use when a link attempt fails, the QR expired, or the dashboard
   is stuck and not showing a QR.
========================= */

app.post("/relink", requireAuth, async (req, res) => {
  try {
    await relink();
    res.json({
      success: true,
      message: "Link reset. A fresh QR code is being generated - scan it with WhatsApp."
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================
   HEALTH (no auth — deploy check)
========================= */

app.get("/health", async (req, res) => {
  const wa = await getStatus();
  res.json({
    ok: true,
    buildId: BUILD_ID,
    whatsapp: wa.status,
    service: "otp"
  });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`PhyllHost WhatsApp OTP service listening on port ${PORT}`);
  startWhatsApp().catch((error) => {
    console.error("Failed to start WhatsApp:", error);
  });
});
