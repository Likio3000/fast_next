/* main.js – vanilla ES‑module chat frontend */
const BACKEND_URL = "/chat";

const $ = s => document.querySelector(s);

const chat   = $("#chat");
const input  = $("#input");
const send   = $("#send");
const tBtn   = $("#themeToggle");
const tIcon  = $("#themeIcon");

const THEME_KEY = "ai-chat-theme";
initTheme();

/* ───────── helpers ───────── */
function scrollBottom() { chat.scrollTop = chat.scrollHeight; }

function escape(s) { return s.replace(/[&<>]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c])); }

function addMsg(html, cls) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.innerHTML = cls === "user" ? escape(html) : marked.parse(String(html));
  chat.appendChild(div);
  enhanceCode(div);
  scrollBottom();
  return div;
}

function enhanceCode(root) {
  root.querySelectorAll("pre code").forEach(code => {
    if (window.hljs) hljs.highlightElement(code);
    if (!code.parentElement.querySelector(".copy-btn")) {
      const btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.onclick = () => {
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.textContent = "✓";
          setTimeout(() => (btn.textContent = "Copy"), 1500);
        });
      };
      code.parentElement.appendChild(btn);
    }
  });
}

/* ───────── theme ───────── */
function initTheme() {
  const def = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  setTheme(localStorage.getItem(THEME_KEY) || def);
  tBtn.onclick = () => setTheme(document.body.classList.contains("light-theme") ? "dark" : "light");
}

function setTheme(t) {
  document.body.classList.toggle("light-theme", t === "light");
  localStorage.setItem(THEME_KEY, t);
  tIcon.innerHTML = t === "light"
    ? '<path d="M5.64 17.656L4.22 19.07 1.634 16.485l1.414-1.414zM12 18a6 6 0 100-12 6 6 0 000 12zm8.364-1.515l1.414 1.414-2.586 2.586-1.414-1.414zM22 13h2v-2h-2zm-10 9h2v2h-2zm9-11h2v-2h-2zM2 13H0v-2h2zm9-11h2V0h-2zm6.364 4.343l1.414-1.414 2.586 2.586-1.414 1.414zM4.22 4.93L5.636 3.515 8.22 6.1 6.806 7.515z"/>'
    : '<path d="M12 4.5a1 1 0 011-1h0a1 1 0 010 2h0a1 1 0 01-1-1zm0 14a1 1 0 011-1h0a1 1 0 010 2h0a1 1 0 01-1-1zm7.5-7.5a1 1 0 011 1v0a1 1 0 01-2 0v0a1 1 0 011-1zM4.5 12a1 1 0 011 1v0a1 1 0 01-2 0v0a1 1 0 011-1zm11.036-6.036a1 1 0 011.414 0v0a1 1 0 11-1.414-1.414v0a1 1 0 010 1.414zM6.05 17.95a1 1 0 011.414 0v0a1 1 0 01-1.414 1.414v0a1 1 0 010-1.414zm12.9 0a1 1 0 011.414 0v0a1 1 0 01-1.414 1.414v0a1 1 0 010-1.414zM6.05 6.05a1 1 0 011.414 0v0a1 1 0 01-1.414-1.414v0a1 1 0 010 1.414z"/>';
}

/* ───────── chat flow ───────── */
send.onclick = sendMsg;
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = input.scrollHeight + "px";
});

async function sendMsg() {
  const text = input.value.trim();
  if (!text) return;

  addMsg(text, "user");
  input.value = ""; input.style.height = "auto";
  send.disabled = true;

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_message: text })
    });
    if (!res.body) throw new Error(res.statusText || "No body");

    const rdr = res.body.getReader();
    const td = new TextDecoder();
    let buf = "", genName = "", streamDiv, streamTxt = "";

    while (true) {
      const { value, done } = await rdr.read();
      if (done) break;
      buf += td.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const ln of lines) {
        if (!ln.trim()) continue;
        const m = JSON.parse(ln);

        if (m.type === "suggestions") {
          addMsg(`**${m.agent}:**\n\n${m.content}`, "sugg");
        } else if (m.type === "generated_code_chunk") {
          if (genName !== m.agent) {
            genName = m.agent;
            streamTxt = m.content;
            streamDiv = addMsg(`**${genName}:**\n\n${m.content}<span class="streaming-cursor"></span>`, "code");
          } else {
            streamTxt += m.content;
            streamDiv.innerHTML =
            marked.parse(`**${genName}:**\n\n${streamTxt}`) +
            '<span class="streaming-cursor"></span>';
          
            enhanceCode(streamDiv);
          }
          scrollBottom();
        } else if (m.type === "error") {
          addMsg(`**Error from ${m.agent}:**\n\n${m.content}`, "error");
        }
      }
    }
    if (streamDiv) streamDiv.querySelector(".streaming-cursor").remove();
  } catch (err) {
    addMsg("Client error: " + err.message, "error");
  } finally {
    send.disabled = false;
    input.focus();
  }
}
