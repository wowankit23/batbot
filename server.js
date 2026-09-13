// server.js
// WhatsApp Cloud API webhook server — ready to deploy on Render.
// Every step logs to console so Render's Logs tab shows exactly what's happening.

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const multer = require("multer");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  GEMINI_API_KEY,
  ADMIN_WHATSAPP_NUMBER = "919646232525",
  GRAPH_API_VERSION = "v23.0",
  PORT = 3000,
} = process.env;

// Serve the cricket bat inspection form at /
app.use(express.static(path.join(__dirname, "public")));

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
app.get("/health", (req, res) => {
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

// ---------------------------------------------------------------------------
// Helper: send the uploaded photos to Gemini Vision.
// Asks Gemini to (1) confirm each general photo actually shows a cricket bat,
// and (2) write a short condition report covering the grip/handle.
// ---------------------------------------------------------------------------
async function analyzeBatWithGemini(photoParts, handleCrackedByUser) {
  console.log(`🤖 Calling Gemini with ${photoParts.length} image(s). User says handle cracked: ${handleCrackedByUser}`);

  const prompt = `You are inspecting photos of a cricket bat for a grip-replacement business.
You are given ${photoParts.length} photo(s). The first ones are general photos of the bat.
${handleCrackedByUser ? "The last photo is a close-up the customer took of a crack in the handle/grip area." : ""}
The customer has stated the handle/grip is ${handleCrackedByUser ? "CRACKED" : "NOT cracked"}.

For each of the FIRST ${handleCrackedByUser ? photoParts.length - 1 : photoParts.length} photos (index starting at 1), decide if it clearly shows a cricket bat.
Then write a short, friendly condition report (4-6 sentences) covering: overall bat condition, grip/handle condition (mention the crack if present), and a one-line recommendation (e.g. "grip replacement recommended" or "grip is in good condition").

Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "photos": [ { "index": 1, "is_cricket_bat": true, "reason": "short reason if false, empty string if true" } ],
  "report": "the condition report text"
}`;

  const parts = [{ text: prompt }, ...photoParts];

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts }],
      generationConfig: { response_mime_type: "application/json" },
    }
  );

  const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  console.log("🤖 Gemini raw response:", rawText);

  const cleaned = rawText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// POST /api/inspect
// Receives photo1..photo4 (required), crackedPhoto (only if handleCracked=true),
// handleCracked ("true"/"false"), and whatsapp (recipient number).
// Validates the bat photos via Gemini, generates a report, and sends it
// straight to the customer's WhatsApp number.
// ---------------------------------------------------------------------------
app.post(
  "/api/inspect",
  upload.fields([
    { name: "photo1", maxCount: 1 },
    { name: "photo2", maxCount: 1 },
    { name: "photo3", maxCount: 1 },
    { name: "photo4", maxCount: 1 },
    { name: "crackedPhoto", maxCount: 1 },
  ]),
  async (req, res) => {
    console.log("📨 POST /api/inspect received.");

    try {
      const { handleCracked } = req.body;
      const isCracked = handleCracked === "true";

      console.log(`   handleCracked: ${isCracked}`);

      const generalKeys = ["photo1", "photo2", "photo3", "photo4"];
      const missing = generalKeys.filter((k) => !req.files?.[k]?.[0]);
      if (missing.length > 0) {
        console.warn("⚠️  Missing required photos:", missing);
        return res.status(400).json({ success: false, error: `Missing photos: ${missing.join(", ")}` });
      }
      if (isCracked && !req.files?.crackedPhoto?.[0]) {
        console.warn("⚠️  handleCracked=true but no crackedPhoto uploaded.");
        return res.status(400).json({ success: false, error: "Please upload a close-up photo of the crack." });
      }

      // Build Gemini image parts — general photos first, cracked close-up last.
      const orderedFiles = generalKeys.map((k) => req.files[k][0]);
      if (isCracked) orderedFiles.push(req.files.crackedPhoto[0]);

      const photoParts = orderedFiles.map((f) => ({
        inline_data: { mime_type: f.mimetype, data: f.buffer.toString("base64") },
      }));

      console.log(`   🖼️  ${photoParts.length} images prepared for Gemini.`);

      const analysis = await analyzeBatWithGemini(photoParts, isCracked);

      const invalidPhotos = (analysis.photos || []).filter((p) => !p.is_cricket_bat);
      if (invalidPhotos.length > 0) {
        console.warn("⚠️  Gemini flagged non-bat photos:", JSON.stringify(invalidPhotos));
        return res.status(422).json({
          success: false,
          error: "One or more photos don't look like a cricket bat.",
          invalidPhotos,
        });
      }

      const reportText = analysis.report || "Inspection complete — no report text returned.";
      console.log("📝 Report generated:", reportText);

      res.json({ success: true, report: reportText });
    } catch (err) {
      console.error("❌ /api/inspect failed:", err.message);
      console.error(err.stack);
      res.status(500).json({ success: false, error: "Something went wrong analyzing the bat. Please try again." });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/send-report
// Takes the already-generated report text and sends it to the fixed admin
// WhatsApp number (ADMIN_WHATSAPP_NUMBER). Triggered by the "Send Report"
// button on the page, after the customer has seen the report.
// ---------------------------------------------------------------------------
app.post("/api/send-report", async (req, res) => {
  console.log("📨 POST /api/send-report received.");

  try {
    const { report } = req.body;
    if (!report) {
      return res.status(400).json({ success: false, error: "No report text provided." });
    }

    console.log(`   Sending report to admin number: ${ADMIN_WHATSAPP_NUMBER}`);

    try {
      await sendTextMessage(ADMIN_WHATSAPP_NUMBER, `🏏 Bat Inspection Report\n\n${report}`);
      console.log(`✅ Report sent to ${ADMIN_WHATSAPP_NUMBER} via WhatsApp.`);
      res.json({ success: true });
    } catch (sendErr) {
      console.error("❌ Failed to send report via WhatsApp:", JSON.stringify(sendErr.response?.data || sendErr.message));
      res.status(502).json({ success: false, error: "Could not send the report on WhatsApp. Please try again." });
    }
  } catch (err) {
    console.error("❌ /api/send-report failed:", err.message);
    res.status(500).json({ success: false, error: "Something went wrong sending the report." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  console.log("👂 Waiting for requests...");
});
