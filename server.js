// server.js
// WhatsApp Cloud API webhook server — ready to deploy on Render.
// Every step logs to console so Render's Logs tab shows exactly what's happening.

require("dotenv").config();

const express = require("express");
const axios = require("axios");

const app = express();

console.log("🚀 Starting WhatsApp webhook server...");

// ---------------------------------------------------------------------------
// Log EVERY incoming request, no matter the path or method.
// This runs first, before any route matching, so we always see traffic hit us.
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  console.log(`🌐 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());

const {
  VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  GRAPH_API_VERSION = "v23.0",
  PORT = 3000,
} = process.env;

// ---------------------------------------------------------------------------
// Startup check: warn loudly if any required env var is missing.
// ---------------------------------------------------------------------------
console.log("🔧 Checking environment variables...");
const REQUIRED_VARS = { VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID };
let missingAny = false;
for (const [key, value] of Object.entries(REQUIRED_VARS)) {
  if (!value) {
    console.error(`❌ MISSING environment variable: ${key}`);
    missingAny = true;
  } else {
    console.log(`✅ ${key} is set (length: ${value.length})`);
  }
}
if (missingAny) {
  console.error("❌ Fix the missing environment variables above before testing.");
} else {
  console.log("✅ All required environment variables are present.");
}
console.log(`ℹ️  Using Graph API version: ${GRAPH_API_VERSION}`);

// ---------------------------------------------------------------------------
// Health check (useful for confirming the service is live on Render)
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  console.log("💓 Health check hit — server is alive.");
  res.send("WhatsApp webhook server is running.");
});

// ---------------------------------------------------------------------------
// Step 1: Webhook verification (Meta calls this once when you save the
// webhook URL in the App Dashboard -> WhatsApp -> Configuration)
// ---------------------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔐 Webhook verification attempt received.");
  console.log(`   mode: ${mode}`);
  console.log(`   token received: ${token}`);
  console.log(`   token expected:  ${VERIFY_TOKEN}`);
  console.log(`   challenge: ${challenge}`);

  if (!VERIFY_TOKEN) {
    console.error("❌ Cannot verify — VERIFY_TOKEN is not set on the server.");
    return res.sendStatus(500);
  }

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully. Responding with challenge.");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification FAILED — mode or token did not match.");
  return res.sendStatus(403);
});

// ---------------------------------------------------------------------------
// Step 2: Receive incoming messages and status updates
// ---------------------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  // Always 200 immediately — Meta retries aggressively if it doesn't get one.
  res.sendStatus(200);

  console.log("📨 POST /webhook received.");
  console.log("   Raw body:", JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!entry || !change || !value) {
      console.warn("⚠️  Payload did not match expected WhatsApp webhook structure.");
      return;
    }

    // Incoming user messages
    const message = value?.messages?.[0];
    if (message) {
      const from = message.from; // sender's WhatsApp number
      const text = message.text?.body;
      const type = message.type;

      console.log(`📩 Incoming message — from: ${from}, type: ${type}, text: ${text || "(none)"}`);

      if (!text) {
        console.log(`   ⏭️  Skipping auto-reply — message type "${type}" has no text body.`);
        return;
      }

      console.log(`   ➡️  Attempting to send echo reply to ${from}...`);
      try {
        const result = await sendTextMessage(from, `You said: "${text}"`);
        console.log(`✅ Echo reply sent successfully to ${from}. Message ID: ${result.data?.messages?.[0]?.id}`);
      } catch (sendErr) {
        console.error(`❌ Failed to send reply to ${from}.`);
        console.error("   Meta API error response:", JSON.stringify(sendErr.response?.data || sendErr.message, null, 2));
      }
    } else {
      console.log("ℹ️  No 'messages' array in this webhook payload (likely a status update only).");
    }

    // Message status updates (sent, delivered, read, failed)
    const status = value?.statuses?.[0];
    if (status) {
      if (status.status === "failed") {
        console.error(`❌ Message delivery FAILED — id: ${status.id}, recipient: ${status.recipient_id}`);
        console.error("   Errors:", JSON.stringify(status.errors || {}, null, 2));
      } else {
        console.log(`📊 Status update — id: ${status.id}, status: ${status.status}, recipient: ${status.recipient_id || "n/a"}`);
      }
    }
  } catch (err) {
    console.error("❌ Unexpected error while handling webhook payload:", err.message);
    console.error(err.stack);
  }
});

// ---------------------------------------------------------------------------
// Helper: send a plain text message (only works inside an open 24h window,
// or use sendTemplateMessage below to start a new conversation)
// ---------------------------------------------------------------------------
async function sendTextMessage(to, body) {
  console.log(`   📤 sendTextMessage() called — to: ${to}, body: "${body}"`);
  console.log(`   📤 Using phone number ID: ${WHATSAPP_PHONE_NUMBER_ID}, API version: ${GRAPH_API_VERSION}`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("   📤 sendTextMessage() response:", JSON.stringify(response.data, null, 2));
    return response;
  } catch (err) {
    console.error("   📤 sendTextMessage() threw an error:", JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helper: send a pre-approved template message (needed to start a
// conversation outside the 24h window, e.g. "hello_world" for testing)
// ---------------------------------------------------------------------------
async function sendTemplateMessage(to, templateName = "hello_world", languageCode = "en_US") {
  console.log(`   📤 sendTemplateMessage() called — to: ${to}, template: ${templateName}, lang: ${languageCode}`);
  console.log(`   📤 Using phone number ID: ${WHATSAPP_PHONE_NUMBER_ID}, API version: ${GRAPH_API_VERSION}`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("   📤 sendTemplateMessage() response:", JSON.stringify(response.data, null, 2));
    return response;
  } catch (err) {
    console.error("   📤 sendTemplateMessage() threw an error:", JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Simple test route to manually trigger an outbound template message.
// POST { "to": "15551234567" } to /send-template
// ---------------------------------------------------------------------------
app.post("/send-template", async (req, res) => {
  console.log("📨 POST /send-template received. Body:", JSON.stringify(req.body, null, 2));

  try {
    const { to, templateName, languageCode } = req.body;
    if (!to) {
      console.warn("⚠️  /send-template called without a 'to' number.");
      return res.status(400).json({ error: "Missing 'to' phone number." });
    }

    const response = await sendTemplateMessage(to, templateName, languageCode);
    console.log(`✅ /send-template succeeded for ${to}.`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    console.error("❌ /send-template failed:", JSON.stringify(err.response?.data || err.message, null, 2));
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  console.log("👂 Waiting for requests...");
});
