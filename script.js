// KING's ChatBot by KING_YOSEF_
// If the page and server are on different sites (e.g. GitHub Pages + Render), put the server URL here.
const API = "";

const $ = id => document.getElementById(id);
const chat = $("chat"), input = $("input"), sendBtn = $("send"), preview = $("preview");
let token = localStorage.getItem("token") || "";
let currentId = null, pendingImage = null, mode = "login", busy = false;

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 401 && token && path !== "/api/login") { logoutLocal(); throw new Error("Please log in again."); }
  if (!res.ok && !opts.raw) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
  return opts.raw ? res : res.json();
}
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const render = t => esc(t)
  .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
  .replace(/`([^`\n]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
function addMsg(role, text, imgSrc, cls) {
  const el = document.createElement("div");
  el.className = "msg " + role + (cls ? " " + cls : "");
  if (imgSrc) { const i = document.createElement("img"); i.src = imgSrc; el.appendChild(i); }
  const s = document.createElement("span"); s.innerHTML = render(text); el.appendChild(s);
  chat.appendChild(el); chat.scrollTop = chat.scrollHeight;
  return s;
}
const imgSrc = m => m.image ? `data:${m.image.media_type};base64,${m.image.data}` : null;

// ---------- theme ----------
$("theme").onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
};
addEventListener("pointermove", e => {
  document.body.style.setProperty("--mx", e.clientX + "px");
  document.body.style.setProperty("--my", e.clientY + "px");
});

// ---------- auth ----------
function setMode(m) {
  mode = m;
  $("tabLogin").classList.toggle("on", m === "login");
  $("tabSignup").classList.toggle("on", m === "signup");
  $("authBtn").textContent = m === "login" ? "Log in" : "Create account";
  $("authSub").textContent = m === "login" ? "Log in to see your saved chats." : "Pick a username and password. No email needed.";
  $("pass").autocomplete = m === "login" ? "current-password" : "new-password";
  $("authErr").textContent = "";
}
$("tabLogin").onclick = () => setMode("login");
$("tabSignup").onclick = () => setMode("signup");
$("authForm").onsubmit = async e => {
  e.preventDefault();
  $("authBtn").disabled = true;
  try {
    const r = await api(mode === "login" ? "/api/login" : "/api/signup", { method: "POST", body: { username: $("user").value, password: $("pass").value } });
    token = r.token; localStorage.setItem("token", token);
    $("pass").value = "";
    enterApp(r.name);
  } catch (err) { $("authErr").textContent = err.message; }
  $("authBtn").disabled = false;
};
function logoutLocal() {
  token = ""; localStorage.removeItem("token");
  $("app").hidden = true; $("auth").hidden = false;
}
$("logout").onclick = async () => { try { await api("/api/logout"); } catch {} logoutLocal(); };

async function enterApp(name) {
  $("auth").hidden = true; $("app").hidden = false;
  $("me").textContent = name;
  await loadList();
  newChat();
}
(async () => {
  if (!token) return;
  try { enterApp((await api("/api/me")).name); } catch {}
})();

// ---------- sidebar / history ----------
async function loadList() {
  const list = await api("/api/chats");
  const nav = $("list"); nav.innerHTML = "";
  if (!list.length) nav.innerHTML = '<p class="empty">Your chats will show up here.</p>';
  for (const c of list) {
    const row = document.createElement("div");
    row.className = "item" + (c.id === currentId ? " on" : "");
    const t = document.createElement("span"); t.textContent = c.title;
    const del = document.createElement("button"); del.textContent = "×"; del.title = "Delete chat";
    del.onclick = async ev => {
      ev.stopPropagation();
      if (!confirm("Delete this chat?")) return;
      await api("/api/chats/" + c.id, { method: "DELETE" });
      if (c.id === currentId) newChat();
      loadList();
    };
    row.onclick = () => openChat(c.id);
    row.append(t, del); nav.appendChild(row);
  }
}
function newChat() {
  currentId = null; chat.innerHTML = "";
  addMsg("bot", "Hi, I'm KING's ChatBot. Ask me anything, send a math problem, or attach an image.");
  closeSide(); loadList(); input.focus();
}
async function openChat(id) {
  const c = await api("/api/chats/" + id);
  currentId = id; chat.innerHTML = "";
  for (const m of c.messages) addMsg(m.role === "user" ? "user" : "bot", m.text, imgSrc(m));
  closeSide(); loadList();
}
$("newChat").onclick = newChat;
$("menu").onclick = () => $("app").classList.add("open");
$("scrim").onclick = closeSide;
function closeSide() { $("app").classList.remove("open"); }

// ---------- math (instant, exact, in the browser) ----------
function tryMath(text) {
  const t = text.trim();
  if (!/[0-9]/.test(t) || !/^[\w\s.,+\-*/^%()=!<>|\[\]]+$/.test(t)) return null;
  if (t.split(/\s+/).some(w => /^[a-zA-Z]{4,}$/.test(w) && !(w in math))) return null;
  try {
    const r = math.evaluate(t);
    if (r === undefined || typeof r === "function") return null;
    return math.format(r, { precision: 14 });
  } catch { return null; }
}

// ---------- images ----------
$("file").onchange = () => { if ($("file").files[0]) loadImage($("file").files[0]); };
input.addEventListener("paste", e => {
  const it = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (it) loadImage(it.getAsFile());
});
function loadImage(file) {
  if (file.size > 4 * 1024 * 1024) return alert("Image is too large. Max 4 MB.");
  const r = new FileReader();
  r.onload = () => {
    pendingImage = { media_type: file.type, data: r.result.split(",")[1], url: r.result };
    preview.hidden = false;
    preview.innerHTML = `<img src="${r.result}" alt="Attached image"><button type="button" aria-label="Remove image">×</button>`;
    preview.querySelector("button").onclick = clearImage;
  };
  r.readAsDataURL(file);
}
function clearImage() { pendingImage = null; $("file").value = ""; preview.hidden = true; preview.innerHTML = ""; }

// ---------- sending ----------
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) { e.preventDefault(); $("form").requestSubmit(); }
});
$("form").onsubmit = async e => {
  e.preventDefault();
  const text = input.value.trim(), image = pendingImage;
  if ((!text && !image) || busy) return;
  busy = true; sendBtn.disabled = true;
  addMsg("user", text, image && image.url);
  input.value = ""; input.style.height = "auto"; clearImage();
  const out = addMsg("bot", ""); out.classList.add("typing");
  try {
    if (!currentId) currentId = (await api("/api/chats", { method: "POST" })).id;

    const answer = image ? null : tryMath(text);
    if (answer !== null) {                       // instant local math, then save to history
      out.classList.remove("typing"); out.innerHTML = render("= " + answer);
      out.parentElement.classList.add("math");
      await api(`/api/chats/${currentId}/append`, { method: "POST", body: { messages: [{ role: "user", text }, { role: "assistant", text: "= " + answer }] } });
    } else {
      const res = await api("/api/chat", { method: "POST", raw: true, body: { chatId: currentId, text, image: image && { media_type: image.media_type, data: image.data } } });
      if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = "", full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const l of lines) if (l.startsWith("data:")) {
          try {
            const ev = JSON.parse(l.slice(5));
            if (ev.type === "content_block_delta" && ev.delta.text) { full += ev.delta.text; out.innerHTML = render(full); chat.scrollTop = chat.scrollHeight; }
          } catch {}
        }
      }
    }
  } catch (err) {
    out.innerHTML = render("Something went wrong: " + err.message);
  } finally {
    out.classList.remove("typing");
    busy = false; sendBtn.disabled = false; input.focus();
    loadList();
  }
};