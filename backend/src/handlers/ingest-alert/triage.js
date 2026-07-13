const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const fetch = require("node-fetch");

const ssmClient = new SSMClient({});
let cachedApiKey;

async function getGeminiApiKey() {
  if (cachedApiKey) return cachedApiKey;
  const param = await ssmClient.send(
    new GetParameterCommand({
      Name: "/pulseops/gemini-api-key",
      WithDecryption: true,
    })
  );
  cachedApiKey = param.Parameter.Value;
  return cachedApiKey;
}

async function classifySeverity(message) {
  const apiKey = await getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

  const prompt = `You are triaging an incident alert for an on-call engineering system. Classify the following alert message into exactly one severity level: "critical", "warning", or "info".

- critical: production down, data loss, security breach, complete service outage
- warning: degraded performance, partial outage, approaching resource limits
- info: informational, low urgency, non-production issues

Alert message: "${message}"

Respond with ONLY a JSON object in this exact format, no other text:
{"severity": "critical|warning|info", "reason": "one short sentence explaining why"}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini API error:", JSON.stringify(data));
    throw new Error("Gemini API request failed");
  }

  const rawText = data.candidates[0].content.parts[0].text;
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return parsed;
}

module.exports = { classifySeverity };