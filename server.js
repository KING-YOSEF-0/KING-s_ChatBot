// KING's ChatBot server by KING_YOSEF_
// Run: ANTHROPIC_API_KEY=your_key node server.js   (Node 18+, no npm install needed)
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { Readable } = require("stream");
const { StringDecoder } = require("string_decoder");

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-5-5";
const ORIGIN = process.env.ORIGIN || "*";               // set to your site URL when hosting the page elsewhere
const DB_FILE = path.join(process.env.DATA_DIR || __dirname, "data.json");
const SYSTEM = `You are KING's ChatBot, a fast, friendly and accurate assistant created by KING_YOSEF_.
For math: solve step by step, double-check every calculation, and put the final answer on its own line.
Write math in plain text (x^2, sqrt(x)), not LaTeX. Keep replies concise unless asked for detail.`;

// ---------- tiny JSON database (users, sessions, chats) ----------
let db = { users: {}, sessions: {}, chats: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
let timer;
const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 300); };

const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const readBody = async req => {
  let b = "";
  for await (const c of req) { b += c; if (b.length > 8e6) throw new Error("Request too large"); }
  return b ? JSON.parse(b) : {};
};
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const newSession = key => { const t = crypto.randomBytes(32).toString("hex"); db.sessions[t] = key; save(); return t; };
const fails = {}; // simple login throttle per IP
const tooMany = ip => (fails[ip] || 0) >= 8;

async function handle(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://x"), p = url.pathname;
  if (!p.startsWith("/api/")) return serveStatic(p, res);

  try {
    const ip = req.socket.remoteAddress;
    // ---- auth ----
    if (req.method === "POST" && (p === "/api/signup" || p === "/api/login")) {
      if (tooMany(ip)) return send(res, 429, { error: "Too many attempts. Try again in a few minutes." });
      const { username = "", password = "" } = await readBody(req);
      const key = username.trim().toLowerCase();
      if (p === "/api/signup") {
        if (!/^[a-z0-9_]{3,20}$/.test(key)) return send(res, 400, { error: "Username: 3-20 letters, numbers or underscores." });
        if (password.length < 6 || password.length > 100) return send(res, 400, { error: "Password must be 6-100 characters." });
        if (db.users[key]) return send(res, 409, { error: "That username is taken." });
        const salt = crypto.randomBytes(16).toString("hex");
        db.users[key] = { name: username.trim(), salt, hash: hash(password, salt) };
        db.chats[key] = []; save();
        return send(res, 200, { token: newSession(key), name: db.users[key].name });
      }
      const u = db.users[key];
      const ok = u && crypto.timingSafeEqual(Buffer.from(hash(password, u.salt)), Buffer.from(u.hash));
      if (!ok) { fails[ip] = (fails[ip] || 0) + 1; setTimeout(() => delete fails[ip], 5 * 60e3); return send(res, 401, { error: "Wrong username or password." }); }
      return send(res, 200, { token: newSession(key), name: u.name });
    }

    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const key = db.sessions[token];
    if (!key || !db.users[key]) return send(res, 401, { error: "Please log in." });
    const chats = db.chats[key] || (db.chats[key] = []);

    if (p === "/api/me") return send(res, 200, { name: db.users[key].name });
    if (p === "/api/logout") { delete db.sessions[token]; save(); return send(res, 200, {}); }

    // ---- chats ----
    if (p === "/api/chats" && req.method === "GET")
      return send(res, 200, chats.map(({ id, title, updated }) => ({ id, title, updated })).sort((a, b) => b.updated - a.updated));
    if (p === "/api/chats" && req.method === "POST") {
      const c = { id: crypto.randomUUID(), title: "New chat", updated: Date.now(), messages: [] };
      chats.push(c); save(); return send(res, 200, { id: c.id, title: c.title, updated: c.updated });
    }
    const m = p.match(/^\/api\/chats\/([\w-]+)(\/append)?$/);
    if (m) {
      const i = chats.findIndex(c => c.id === m[1]);
      if (i < 0) return send(res, 404, { error: "Chat not found." });
      const c = chats[i];
      if (!m[2] && req.method === "GET") return send(res, 200, c);
      if (!m[2] && req.method === "DELETE") { chats.splice(i, 1); save(); return send(res, 200, {}); }
      if (m[2] && req.method === "POST") { // saves instant local-math answers
        const { messages = [] } = await readBody(req);
        for (const x of messages) c.messages.push({ role: x.role === "user" ? "user" : "assistant", text: String(x.text).slice(0, 4000) });
        if (c.title === "New chat" && messages[0]) c.title = String(messages[0].text).slice(0, 40);
        c.updated = Date.now(); save(); return send(res, 200, {});
      }
    }
    if (p === "/api/chat" && req.method === "POST") return streamChat(req, res, chats);
    send(res, 404, { error: "Not found." });
  } catch (e) { if (!res.headersSent) send(res, 500, { error: String(e.message || e) }); else res.end(); }
}

async function streamChat(req, res, chats) {
  if (!KEY) return send(res, 500, { error: "ANTHROPIC_API_KEY is not set on the server." });
  const { chatId, text = "", image = null } = await readBody(req);
  const c = chats.find(x => x.id === chatId);
  if (!c) return send(res, 404, { error: "Chat not found." });

  c.messages.push({ role: "user", text, image });
  const msgs = c.messages.slice(-30).map((m, i, a) => {
    const t = m.text || "Describe this image.";
    if (m.image && i === a.length - 1)       // only the newest image is sent, older ones stay on screen only
      return { role: m.role, content: [{ type: "image", source: { type: "base64", media_type: m.image.media_type, data: m.image.data } }, { type: "text", text: t }] };
    return { role: m.role, content: m.image ? "[image] " + t : t };
  });
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  const up = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, stream: true, system: SYSTEM, messages: msgs })
  });
  if (!up.ok) {
    c.messages.pop();
    const bad = up.status === 401 || up.status === 403;
    return send(res, bad ? 502 : up.status, { error: bad ? "The AI key is invalid. Set a real ANTHROPIC_API_KEY and restart the server." : "AI service error: " + (await up.text()).slice(0, 200) });
  }

  if (c.title === "New chat") c.title = (text || "Image chat").slice(0, 40);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let full = "", buf = ""; const dec = new StringDecoder("utf8");
  for await (const chunk of Readable.fromWeb(up.body)) {
    res.write(chunk);
    buf += dec.write(chunk);
    const lines = buf.split("\n"); buf = lines.pop();
    for (const l of lines) if (l.startsWith("data:")) {
      try { const e = JSON.parse(l.slice(5)); if (e.type === "content_block_delta" && e.delta.text) full += e.delta.text; } catch {}
    }
  }
  c.messages.push({ role: "assistant", text: full }); c.updated = Date.now(); save();
  res.end();
}

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
function serveStatic(p, res) {
  const file = p === "/" ? "index.html" : p.replace(/^\/+/, "");
  const full = path.join(__dirname, path.normalize(file));
  if (!full.startsWith(__dirname) || !TYPES[path.extname(full)] || !fs.existsSync(full)) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(full)] });
  fs.createReadStream(full).pipe(res);
}

http.createServer(handle).listen(PORT, () => console.log(`KING's ChatBot by KING_YOSEF_ running at http://localhost:${PORT}`));