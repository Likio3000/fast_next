/* main.js – vanilla ES module chat frontend (dark‑only) */
const BACKEND_URL = '/chat';

const qs = sel => document.querySelector(sel);

const chatEl   = qs('#chat');
const inputEl  = qs('#input');
const sendBtn  = qs('#send');

/* ---------- UI helpers ---------- */
function scrollBottom() { chatEl.scrollTop = chatEl.scrollHeight; }

function mkMsg(text, cls, isHtml = false) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;

  if (isHtml) {
    div.innerHTML = text;
  } else if (cls === 'user') {
    div.textContent = text;
  } else {
    div.innerHTML = marked.parse(String(text));
  }

  chatEl.appendChild(div);
  enhanceCodeBlocks(div);
  scrollBottom();
  return div;
}

function enhanceCodeBlocks(root) {
  root.querySelectorAll('pre code').forEach(code => {
    if (window.hljs) hljs.highlightElement(code);
    if (!code.parentElement.querySelector('.copy-btn')) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.textContent = '✓';
          setTimeout(() => (btn.textContent = 'Copy'), 1500);
        });
      });
      code.parentElement.appendChild(btn);
    }
  });
}

/* ---------- Chat flow ---------- */
let lastSuggestions = null; // {agent, content}

sendBtn.addEventListener('click', handleSend);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = inputEl.scrollHeight + 'px';
});

async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;

  mkMsg(text, 'user');
  inputEl.value = '';
  inputEl.style.height = 'auto';

  await initiateFetchAndStream(text);
}

function addRegenerateButton(msgDiv, originalMessage) {
  if (msgDiv.querySelector('.regenerate-btn')) return;

  const container = document.createElement('div');
  container.className = 'msg-actions';

  const btn = document.createElement('button');
  btn.className = 'regenerate-btn action-btn';
  btn.textContent = 'Regenerate';

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Regenerating…';
    try {
      await initiateFetchAndStream(originalMessage, lastSuggestions);
    } finally {
      msgDiv.remove();
    }
  };

  container.appendChild(btn);
  msgDiv.appendChild(container);
}

async function initiateFetchAndStream(messageToProcess, cachedSuggestion = null) {
  sendBtn.disabled = true;

  let generationAgent = '';
  let generationAccumMd = '';
  let generationMsgEl = null;
  let generationContentSpan = null;

  try {
    const body = { user_message: messageToProcess };
    if (cachedSuggestion) {
      body.cached_suggestions = cachedSuggestion.content;
      body.cached_sugg_agent = cachedSuggestion.agent;
    }

    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.body) throw new Error(res.statusText || 'No body');

    let buf = '';
    const reader = res.body.getReader();
    const td = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += td.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const type = msg.type;

          if (type === 'suggestions') {
            lastSuggestions = { agent: msg.agent, content: msg.content };
            mkMsg(`**${msg.agent}:**\n\n${msg.content}`, 'sugg');
          } else if (type === 'generated_code_chunk') {
            if (!generationMsgEl) {
              generationAgent = msg.agent;
              const initialHtml =
                marked.parse(`**${generationAgent}:**\n\n`) +
                `<span class="streaming-content"></span>` +
                `<span class="streaming-cursor"></span>`;
              generationMsgEl = mkMsg(initialHtml, 'code', true);
              generationContentSpan =
                generationMsgEl.querySelector('.streaming-content');
            }
            generationAccumMd += msg.content;
            if (generationContentSpan) {
              generationContentSpan.innerHTML = marked.parse(generationAccumMd);
              enhanceCodeBlocks(generationContentSpan);
              const cursor = generationMsgEl.querySelector('.streaming-cursor');
              if (cursor) generationMsgEl.appendChild(cursor);
            }
            scrollBottom();
          } else if (type === 'stream_end') {
            if (msg.agent === generationAgent && generationMsgEl) {
              const cursor = generationMsgEl.querySelector('.streaming-cursor');
              if (cursor) cursor.remove();
              if (generationContentSpan && generationAccumMd) {
                generationContentSpan.innerHTML = marked.parse(generationAccumMd);
                enhanceCodeBlocks(generationContentSpan);
              }
              generationMsgEl = null;
              generationContentSpan = null;
              generationAccumMd = '';
              generationAgent = '';
            }
          } else if (type === 'error') {
            const errDiv = mkMsg(
              `**Error from ${msg.agent}:**\n\n${msg.content}`,
              'error'
            );
            addRegenerateButton(errDiv, messageToProcess);
          }
        } catch (e) {
          const errDiv = mkMsg(
            `Client-side error parsing stream data.\n\n\`${line}\`\n\n${e.message}`,
            'error'
          );
          addRegenerateButton(errDiv, messageToProcess);
        }
      }
    }

    // flush if stream ended abruptly
    if (generationMsgEl) {
      const cursor = generationMsgEl.querySelector('.streaming-cursor');
      if (cursor) cursor.remove();
      if (generationContentSpan && generationAccumMd) {
        generationContentSpan.innerHTML = marked.parse(generationAccumMd);
        enhanceCodeBlocks(generationContentSpan);
      }
    }
  } catch (err) {
    const errDiv = mkMsg('Client error: ' + err.message, 'error');
    addRegenerateButton(errDiv, messageToProcess);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}
