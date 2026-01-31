// twilio.js
const fetch = require("node-fetch");

function twilioBasicAuthHeader(accountSid, authToken) {
  const raw = `${accountSid}:${authToken}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function sendSmsViaTwilio({ accountSid, authToken, from, to, body }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.set("From", from);
  params.set("To", to);
  params.set("Body", body);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: twilioBasicAuthHeader(accountSid, authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Twilio SMS failed (${resp.status}): ${text}`);
  }
  return JSON.parse(text);
}

module.exports = { sendSmsViaTwilio };
