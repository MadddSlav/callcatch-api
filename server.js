require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");
const { load, save, now } = require("./store");
const { sendSmsViaTwilio } = require("./twilio");

const PORT = Number(process.env.PORT || 8787);
const DRY_RUN = String(process.env.DRY_RUN || "true").toLowerCase() === "true";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

function requireAuth(req, res, next) {
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing Bearer token" });

  const token = m[1].trim();
  const data = load();
  const key = data.apiKeys.find((k) => k.token === token);
  if (!key) return res.status(401).json({ error: "Invalid API key" });

  req.apiKey = key;
  next();
}

app.get("/health", (req, res) => res.json({ ok: true }));

// Admin: create API key
app.post("/admin/api-keys", (req, res) => {
  const data = load();
  const name = (req.body?.name || "").toString().slice(0, 100);

  const token = "sk_" + crypto.randomBytes(24).toString("hex");
  data.apiKeys.push({ id: crypto.randomUUID(), token, name, created_at: now() });
  save(data);

  res.json({ api_key: token, name: name || null });
});

// Register number + behavior
app.post("/v1/numbers", requireAuth, (req, res) => {
  const data = load();
  const phone = (req.body?.number || "").toString().trim();
  const fallbackSms = (req.body?.fallback_sms || "").toString().trim();
  const replyWebhookUrl = (req.body?.reply_webhook_url || "").toString().trim();

  if (!phone.startsWith("+")) return res.status(400).json({ error: "number must be E.164 like +15551234567" });
  if (fallbackSms.length < 3) return res.status(400).json({ error: "fallback_sms required" });
  if (!replyWebhookUrl.startsWith("http")) return res.status(400).json({ error: "reply_webhook_url must be http(s)" });

  const exists = data.numbers.find((n) => n.api_key_id === req.apiKey.id && n.phone === phone);
  if (exists) return res.status(409).json({ error: "Number already registered" });

  data.numbers.push({
    id: crypto.randomUUID(),
    api_key_id: req.apiKey.id,
    phone,
    fallback_sms: fallbackSms,
    reply_webhook_url: replyWebhookUrl,
    created_at: now(),
  });

  save(data);
  res.json({ ok: true, number: phone });
});

// Call event
app.post("/v1/call-event", requireAuth, async (req, res) => {
  const data = load();
  const toNumber = (req.body?.to || "").toString().trim();
  const fromNumber = (req.body?.from || "").toString().trim();
  const status = (req.body?.status || "").toString().trim();
  const providerCallSid = (req.body?.provider_call_sid || "").toString().trim() || null;

  if (!toNumber.startsWith("+") || !fromNumber.startsWith("+")) {
    return res.status(400).json({ error: "to/from must be E.164 +..." });
  }
  if (!status) return res.status(400).json({ error: "status required" });

  data.callEvents.push({
    id: crypto.randomUUID(),
    api_key_id: req.apiKey.id,
    to: toNumber,
    from: fromNumber,
    status,
    provider_call_sid: providerCallSid,
    created_at: now(),
  });

  const missedStatuses = new Set(["no-answer", "busy", "failed"]);
  if (!missedStatuses.has(status)) {
    save(data);
    return res.json({ ok: true, triggered: false });
  }

  const num = data.numbers.find((n) => n.api_key_id === req.apiKey.id && n.phone === toNumber);
  if (!num) {
    save(data);
    return res.status(404).json({ error: "Number not registered. POST /v1/numbers" });
  }

  const smsBody = num.fallback_sms;

  if (DRY_RUN) {
    console.log("[DRY_RUN] Would send SMS:", { to: fromNumber, from: TWILIO_FROM_NUMBER || "(missing)", body: smsBody });
    data.messages.push({
      id: crypto.randomUUID(),
      api_key_id: req.apiKey.id,
      direction: "outbound",
      to: fromNumber,
      from: toNumber,
      body: smsBody,
      provider_message_sid: null,
      created_at: now(),
    });
    save(data);
    return res.json({ ok: true, triggered: true, dry_run: true });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return res.status(500).json({ error: "Twilio not configured. Set TWILIO_* env vars or DRY_RUN=true" });
  }

  try {
    const msg = await sendSmsViaTwilio({
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: TWILIO_AUTH_TOKEN,
      from: TWILIO_FROM_NUMBER,
      to: fromNumber,
      body: smsBody,
    });

    data.messages.push({
      id: crypto.randomUUID(),
      api_key_id: req.apiKey.id,
      direction: "outbound",
      to: fromNumber,
      from: toNumber,
      body: smsBody,
      provider_message_sid: msg.sid || null,
      created_at: now(),
    });

    save(data);
    res.json({ ok: true, triggered: true, message_sid: msg.sid });
  } catch (e) {
    save(data);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Twilio inbound SMS webhook
app.post("/twilio/sms-inbound", async (req, res) => {
  const data = load();
  const toNumber = (req.body?.To || "").toString().trim();
  const fromNumber = (req.body?.From || "").toString().trim();
  const body = (req.body?.Body || "").toString().trim();
  const msgSid = (req.body?.MessageSid || "").toString().trim() || null;

  const num = data.numbers.find((n) => n.phone === toNumber);
  if (!num) return res.status(200).send("OK");

  data.messages.push({
    id: crypto.randomUUID(),
    api_key_id: num.api_key_id,
    direction: "inbound",
    to: toNumber,
    from: fromNumber,
    body,
    provider_message_sid: msgSid,
    created_at: now(),
  });

  save(data);

  // Forward reply
  try {
    await fetch(num.reply_webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: toNumber, from: fromNumber, message: body, received_at: now() }),
    });
  } catch (e) {
    console.warn("Failed to forward reply:", e.message);
  }

  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`CallCatch API running on http://localhost:${PORT}`);
  console.log(`DRY_RUN=${DRY_RUN}`);
});
