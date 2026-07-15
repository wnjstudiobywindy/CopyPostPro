// CopyPost - Groq API (server-side key, no billing required)
exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const availableKeys = Object.keys(process.env).filter(k => !k.startsWith("_") && !k.startsWith("AWS") && !k.startsWith("NETLIFY") && !k.startsWith("LAMBDA")).join(", ") || "(tidak ada env var custom terdeteksi)";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: `API key not configured on server. [DEBUG] Env vars terlihat: ${availableKeys}` } })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const prompt = body.messages?.[0]?.content || "";

    if (!prompt) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { message: "Prompt is empty." } })
      };
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        max_tokens: 1000
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { message: `${data.error?.message || "Groq API error"} [DEBUG] key length: ${apiKey.length}, prefix: ${apiKey.slice(0,4)}` } })
      };
    }

    const text = data.choices?.[0]?.message?.content || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text }] })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { message: err.message } })
    };
  }
};
