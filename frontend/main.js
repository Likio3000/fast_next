/* main.js – vanilla ES module chat frontend (dark‑only) */
const BACKEND_URL = '/chat';
const qs = sel => document.querySelector(sel);

const chatEl  = qs('#chat');
const inputEl = qs('#input');
const sendBtn = qs('#send');

/* ---------- UI helpers ---------- */
function scrollBottom() { chatEl.scrollTop = chatEl.scrollHeight; }

/**
 * Creates and shows a loader message.
 * @param {string} id - A unique ID for the loader element.
 * @param {string} text - The text to display next to the animation.
 */
function showLoader(id, text) {
  hideLoader(id); // Ensure no duplicates
  const div = document.createElement('div');
  div.className = 'msg loader';
  div.id = id;
  div.innerHTML = `\n    <div class="loading-dots"><span></span><span></span><span></span></div>\n    <span>${text}</span>`;
  chatEl.appendChild(div);
  scrollBottom();
}

/**
 * Removes a loader message by its ID.
 * @param {string} id - The ID of the loader element to remove.
 */
function hideLoader(id) {
  const loader = qs(`#${id}`);
  if (loader) loader.remove();
}

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

  lastSuggestions = null; // Reset suggestions for a new query
  showLoader('initial-loader', 'Thinking...');
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
    showLoader('initial-loader', 'Regenerating...');
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

  // streaming state – suggestions
  let suggAgent = '';
  let suggAccumMd = '';
  let suggMsgEl = null;
  let suggContentSpan = null;

  // streaming state – generated code
  let genAgent = '';
  let genAccumMd = '';
  let genMsgEl = null;
  let genContentSpan = null;

  let initialLoaderHidden = false;

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
        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          mkMsg('Client‑side JSON parse error.', 'error');
          continue;
        }

        // Hide initial loader as soon as the first content chunk arrives.
        if (!initialLoaderHidden && (msg.type === 'suggestions_chunk' || msg.type === 'generated_code_chunk')) {
          hideLoader('initial-loader');
          initialLoaderHidden = true;
        }

        const type = msg.type;

        /* ---------- suggestions flow ---------- */
        if (type === 'suggestions_chunk') {
          if (!suggMsgEl) {
            suggAgent = msg.agent;
            const initialHtml =
              marked.parse(`**${suggAgent}:**\n\n`) +
              '<span class="sugg-content"></span><span class="streaming-cursor"></span>';
            suggMsgEl = mkMsg(initialHtml, 'sugg', true);
            suggContentSpan = suggMsgEl.querySelector('.sugg-content');
          }
          suggAccumMd += msg.content;
          if (suggContentSpan) {
            suggContentSpan.innerHTML = marked.parse(suggAccumMd);
            enhanceCodeBlocks(suggContentSpan);
            const cursor = suggMsgEl.querySelector('.streaming-cursor');
            if (cursor) suggMsgEl.appendChild(cursor);
          }
          scrollBottom();
          continue;
        }

        if (type === 'suggestions_end') {
          if (msg.agent === suggAgent && suggMsgEl) {
            const cursor = suggMsgEl.querySelector('.streaming-cursor');
            if (cursor) cursor.remove();
            if (suggContentSpan && suggAccumMd) {
              suggContentSpan.innerHTML = marked.parse(suggAccumMd);
              enhanceCodeBlocks(suggContentSpan);
            }
            lastSuggestions = { agent: suggAgent, content: suggAccumMd };
            addRegenerateButton(suggMsgEl, messageToProcess); // Add regenerate to suggestions
            suggAgent = '';
            suggAccumMd = '';
            suggMsgEl = null;
            suggContentSpan = null;
          }
          // Show loader for the generation phase
          showLoader('generation-loader', 'Generating implementation...');
          continue;
        }

        /* ---------- generated code flow ---------- */
        if (type === 'generated_code_chunk') {
          hideLoader('generation-loader'); // Hide loader when code starts
          if (!genMsgEl) {
            genAgent = msg.agent;
            const initialHtml =
              marked.parse(`**${genAgent}:**\n\n`) +
              '<span class="gen-content"></span><span class="streaming-cursor"></span>';
            genMsgEl = mkMsg(initialHtml, 'code', true);
            genContentSpan = genMsgEl.querySelector('.gen-content');
          }
          genAccumMd += msg.content;
          if (genContentSpan) {
            genContentSpan.innerHTML = marked.parse(genAccumMd);
            enhanceCodeBlocks(genContentSpan);
            const cursor = genMsgEl.querySelector('.streaming-cursor');
            if (cursor) genMsgEl.appendChild(cursor);
          }
          scrollBottom();
          continue;
        }

        if (type === 'stream_end') {
          if (msg.agent === genAgent && genMsgEl) {
            const cursor = genMsgEl.querySelector('.streaming-cursor');
            if (cursor) cursor.remove();
            if (genContentSpan && genAccumMd) {
              genContentSpan.innerHTML = marked.parse(genAccumMd);
              enhanceCodeBlocks(genContentSpan);
            }
            addRegenerateButton(genMsgEl, messageToProcess);
            genAgent = '';
            genAccumMd = '';
            genMsgEl = null;
            genContentSpan = null;
          }
          continue;
        }

        /* ---------- error ---------- */
        if (type === 'error') {
          const errDiv = mkMsg(
            `**Error from ${msg.agent}:**\n\n${msg.content}`,
            'error'
          );
          addRegenerateButton(errDiv, messageToProcess);
        }
      }
    }

    /* flush hanging cursors if stream ended abruptly */
    if (genMsgEl) {
      const cursor = genMsgEl.querySelector('.streaming-cursor');
      if (cursor) cursor.remove();
      if (genContentSpan && genAccumMd) {
        genContentSpan.innerHTML = marked.parse(genAccumMd);
        enhanceCodeBlocks(genContentSpan);
        addRegenerateButton(genMsgEl, messageToProcess);
      }
    }
    if (suggMsgEl) {
      const cursor = suggMsgEl.querySelector('.streaming-cursor');
      if (cursor) cursor.remove();
      if (suggContentSpan && suggAccumMd) {
        suggContentSpan.innerHTML = marked.parse(suggAccumMd);
        enhanceCodeBlocks(suggContentSpan);
      }
      lastSuggestions = { agent: suggAgent, content: suggAccumMd };
      addRegenerateButton(suggMsgEl, messageToProcess);
    }
  } catch (err) {
    const errDiv = mkMsg('Client error: ' + err.message, 'error');
    addRegenerateButton(errDiv, messageToProcess);
  } finally {
    // Cleanup any loaders that might be left over
    hideLoader('initial-loader');
    hideLoader('generation-loader');
    sendBtn.disabled = false;
    inputEl.focus();
  }
}
