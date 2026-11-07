const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const fileInput = document.getElementById("file");
const preview = document.getElementById("preview");

let history = [];        // conversation sent to the AI
let pendingImage = null; // { media_type, data, url }

// ---------- helpers ----------
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function render(text) {
  // minimal markdown: code blocks, inline code, bold
  return escapeHtml(text)
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}
function addMsg(role, text, imgUrl, extraClass) {
  const el = document.createElement("div");
  el.className = "msg " + role + (extraClass ? " " + extraClass : "");
  if (imgUrl) {
    const img = document.createElement("img");
    img.src = imgUrl;
    el.appendChild(img);
  }
  const span = document.createElement("span");
  span.innerHTML = render(text);
  el.appendChild(span);
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return span;
}

// ---------- local math engine (instant, exact) ----------
// If the whole message is a math expression, solve it locally with math.js.
function tryMath(text) {
  const t = text.trim();
  if (!/[0-9]/.test(t) || !/^[\w\s.,+\-*/^%()=!<>|\[\]]+$/.test(t)) return null;
  if (/^[a-zA-Z\s]+$/.test(t)) return null;           // plain words
  if (t.split(/\s+/).filter(w => /^[a-zA-Z]{4,}$/.test(w) && !math[w]).length) return null;
  try {
    const res = math.evaluate(t);
    if (res === undefined || typeof res === "function") return null;
    return math.format(res, { precision: 14 });
  } catch { return null; }
}

// ---------- image attach ----------
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (f) loadImage(f);
});
input.addEventListener("paste", e => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) loadImage(item.getAsFile());
});
function loadImage(file) {
  if (file.size > 5 * 1024 * 1024) return alert("Image is too large. Max 5 MB.");
  const reader = new FileReader();
  reader.onload = () => {
    const url = reader.result;
    pendingImage = { media_type: file.type, data: url.split(",")[1], url };
    preview.hidden = false;
    preview.innerHTML = `<img src="${url}" alt="Attached image"><button type="button" aria-label="Remove image">×</button>`;
    preview.querySelector("button").onclick = clearImage;
  };
  reader.readAsDataURL(file);
}
function clearImage() {
  pendingImage = null;
  fileInput.value = "";
  preview.hidden = true;
  preview.innerHTML = "";
}

// ---------- sending ----------
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !/Mobi|Android/i.test(navigator.userAgent)) {
    e.preventDefault();
    form.requestSubmit();
  }
});
document.getElementById("clear").onclick = () => {
  history = [];
  chat.innerHTML = "";
  addMsg("bot", "New chat started. What would you like to do?");
};

form.addEventListener("submit", async e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text && !pendingImage) return;

  const image = pendingImage;
  addMsg("user", text, image && image.url);
  input.value = "";
  input.style.height = "auto";
  clearImage();

  // 1) Instant local math
  if (!image) {
    const answer = tryMath(text);
    if (answer !== null) {
      addMsg("bot", "= " + answer, null, "math");
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: "= " + answer });
      return;
    }
  }

  // 2) AI (streamed)
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } });
  content.push({ type: "text", text: text || "Describe this image." });
  history.push({ role: "user", content });

  sendBtn.disabled = true;
  const out = addMsg("bot", "");
  out.classList.add("typing");
  let full = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history })
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5));
          if (ev.type === "content_block_delta" && ev.delta.text) {
            full += ev.delta.text;
            out.innerHTML = render(full);
            chat.scrollTop = chat.scrollHeight;
          }
        } catch {}
      }
    }
    history.push({ role: "assistant", content: full });
  } catch (err) {
    out.innerHTML = render("Something went wrong: " + err.message + "\nCheck that the server is running and your API key is set.");
    history.pop();
  } finally {
    out.classList.remove("typing");
    sendBtn.disabled = false;
    input.focus();
  }
});