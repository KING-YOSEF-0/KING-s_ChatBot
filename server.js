// Run: ANTHROPIC_API_KEY=your_key node server.js   (Node 18+, no npm install needed)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";

const SYSTEM = `You are KING's ChatBot, a fast, friendly and accurate assistant.
For math: solve step by step, double-check every calculation, and state the final answer clearly on its own line.
Write math in plain text (e.g. x^2, sqrt(x)), not LaTeX. Keep replies concise unless asked for detail.`;

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

http.createServer(async (req, res) => {
  // ---- API proxy ----
  if (req.method === "POST" && req.url === "/api/chat") {
    if (!API_KEY) { res.writeHead(500); return res.end("ANTHROPIC_API_KEY is not set on the server."); }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { messages } = JSON.parse(body);
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          stream: true,
          system: SYSTEM,
          messages: messages.slice(-30) // keep requests small and fast
        })
      });
      if (!upstream.ok) { res.writeHead(upstream.status); return res.end(await upstream.text()); }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
    return;
  }

  // ---- static files ----
  const file = req.url === "/" ? "index.html" : req.url.split("?")[0].replace(/^\/+/, "");
  const full = path.join(__dirname, path.normalize(file));
  if (!full.startsWith(__dirname) || !TYPES[path.extname(full)] || !fs.existsSync(full)) {
    res.writeHead(404); return res.end("Not found");
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(full)] });
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => console.log(`KING's ChatBot running at http://localhost:${PORT}`));