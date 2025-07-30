/* main.js – vanilla ES module chat frontend (dark-only) */
/*
  This file has been refactored for clarity and robustness,
  adopting TypeScript-style principles with JSDoc for better type safety.
*/

const BACKEND_URL = '/chat';
const qs = sel => document.querySelector(sel);

const chatEl = qs('#chat');
const inputEl = qs('#input');
const sendBtn = qs('#send');

// @type {{agent: string, content: string} | null}
let lastSuggestions = null;

/**
 * Scrolls the chat element to the bottom.
 */
function scrollBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

/**
 * Creates and shows a loader message. Replaces any existing loader with the same ID.
 * @param {'initial-loader' | 'generation-loader'} id - A unique ID for the loader element.
 * @param {string} text - The text to display next to the animation.
 */
function showLoader(id, text) {
  hideLoader(id); // Ensure no duplicates
  const div = document.createElement('div');
  div.className = 'msg loader';
  div.id = id;
  div.innerHTML = `<div class="loading-dots"><span></span><span></span><span></span></div><span>${text}</span>`;
  chatEl.appendChild(div);
  scrollBottom();
}

/**
 * Removes a loader message by its ID.
 * @param {'initial-loader' | 'generation-loader'} id - The ID of the loader element to remove.
 */
function hideLoader(id) {
  qs(`#${id}`)?.remove();
}

/**
 * Creates a new message bubble in the chat.
 * @param {string} text - The content of the message.
 * @param {'user' | 'sugg' | 'code' | 'error'} type - The type of message.
 * @param {boolean} [isHtml=false] - Whether the text is raw HTML.
 * @returns {HTMLElement} The created message element.
 */
function mkMsg(text, type, isHtml = false) {
  const div = document.createElement('div');
  div.className = `msg ${type}`;

  // For user messages, we want to display the raw text without parsing it as Markdown.
  if (type === 'user') {
      const code = document.createElement('code');
      const pre = document.createElement('pre');
      code.textContent = text;
      pre.appendChild(code);
      div.appendChild(pre);
  } else if (isHtml) {
    div.innerHTML = text;
  } else {
    div.innerHTML = marked.parse(text);
  }
  
  chatEl.appendChild(div);
  enhanceCodeBlocks(div);
  scrollBottom();
  return div;
}


/**
 * Finds all code blocks within an element, highlights them, and adds a copy button.
 * @param {HTMLElement} root - The element to search within.
 */
function enhanceCodeBlocks(root) {
  root.querySelectorAll('pre code').forEach(code => {
    if (window.hljs) hljs.highlightElement(code);
    if (code.parentElement.querySelector('.copy-btn')) return; // Already enhanced

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
  });
}

/**
 * Adds a "Regenerate" button to a message.
 * @param {HTMLElement} msgDiv - The message div to add the button to.
 * @param {string} originalMessage - The user's original message to resend.
 * @param {boolean} isForSuggestions - True if this button regenerates suggestions, false for code.
 */
function addRegenerateButton(msgDiv, originalMessage, isForSuggestions) {
  if (msgDiv.querySelector('.regenerate-btn')) return;

  const container = document.createElement('div');
  container.className = 'msg-actions';
  const btn = document.createElement('button');
  btn.className = 'regenerate-btn action-btn';
  btn.textContent = 'Regenerate';

  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Regenerating…';
    showLoader('initial-loader', 'Regenerating…');
    const suggestionsToUse = isForSuggestions ? null : lastSuggestions;
    // Remove the old message block and start a new stream
    msgDiv.remove();
    await initiateFetchAndStream(originalMessage, suggestionsToUse);
  };

  container.appendChild(btn);
  msgDiv.appendChild(container);
}

/**
 * Handles the user sending a message.
 */
async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;

  mkMsg(text, 'user'); // User message is not HTML
  inputEl.value = '';
  inputEl.style.height = 'auto';

  lastSuggestions = null; // Reset for new query
  showLoader('initial-loader', 'Thinking...');
  await initiateFetchAndStream(text, null);
}

/**
 * The core function to fetch and process the streaming response from the backend.
 * @param {string} messageToProcess - The user's code/message.
 * @param {{agent: string, content: string}|null} cachedSuggestion - Pre-existing suggestions, if any.
 */
async function initiateFetchAndStream(messageToProcess, cachedSuggestion) {
  sendBtn.disabled = true;

  // --- State Variables ---
  let suggMsgEl = null, genMsgEl = null;
  let suggAccumMd = '', genAccumMd = '';
  let suggAgent = '', genAgent = '';
  let suggContentSpan = null, genContentSpan = null;
  let hasReceivedData = false;
  let suggestionPhaseIsComplete = !!cachedSuggestion;

  try {
    const res = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_message: messageToProcess,
        cached_suggestions: cachedSuggestion?.content,
        cached_sugg_agent: cachedSuggestion?.agent,
      }),
    });

    if (!res.ok || !res.body) throw new Error(`Server error: ${res.statusText}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last, possibly incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;

        if (!hasReceivedData) {
          hideLoader('initial-loader');
          hasReceivedData = true;
          if (suggestionPhaseIsComplete) {
            showLoader('generation-loader', 'Generating implementation...');
          }
        }

        let msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          console.error('JSON parse error:', line);
          continue;
        }

        switch (msg.type) {
          case 'suggestions_chunk':
            if (!suggMsgEl) {
              suggAgent = msg.agent;
              const html = marked.parse(`**${suggAgent}:**\n\n`) + '<span class="sugg-content"></span><span class="streaming-cursor"></span>';
              suggMsgEl = mkMsg(html, 'sugg', true);
              suggContentSpan = suggMsgEl.querySelector('.sugg-content');
            }
            suggAccumMd += msg.content;
            if (suggContentSpan) suggContentSpan.innerHTML = marked.parse(suggAccumMd);
            scrollBottom();
            break;

          case 'suggestions_end':
            suggestionPhaseIsComplete = true;
            if (suggMsgEl) {
              suggMsgEl.querySelector('.streaming-cursor')?.remove();
              enhanceCodeBlocks(suggMsgEl);
              lastSuggestions = { agent: msg.agent, content: suggAccumMd };
              addRegenerateButton(suggMsgEl, messageToProcess, true);
            }
            showLoader('generation-loader', 'Generating implementation...');
            break;

          case 'generated_code_chunk':
            hideLoader('generation-loader');
            if (!genMsgEl) {
              genAgent = msg.agent;
              const html = marked.parse(`**${genAgent}:**\n\n`) + '<span class="gen-content"></span><span class="streaming-cursor"></span>';
              genMsgEl = mkMsg(html, 'code', true);
              genContentSpan = genMsgEl.querySelector('.gen-content');
            }
            genAccumMd += msg.content;
            if (genContentSpan) {
                genContentSpan.innerHTML = marked.parse(genAccumMd);
                enhanceCodeBlocks(genContentSpan);
            }
            scrollBottom();
            break;

          case 'stream_end':
            hideLoader('generation-loader');
            if (genMsgEl) {
              genMsgEl.querySelector('.streaming-cursor')?.remove();
              addRegenerateButton(genMsgEl, messageToProcess, false);
            }
            break;

          case 'error':
            hideLoader('initial-loader');
            hideLoader('generation-loader');
            const errDiv = mkMsg(`**Error from ${msg.agent}:**\n\n${msg.content}`, 'error');
            addRegenerateButton(errDiv, messageToProcess, !suggestionPhaseIsComplete);
            return; // Stop processing on error
        }
      }
    }
  } catch (err) {
    console.error('Client-side error:', err);
    hideLoader('initial-loader');
    hideLoader('generation-loader');
    const errDiv = mkMsg(`**Client Error:**\n\n${err.message}`, 'error');
    addRegenerateButton(errDiv, messageToProcess, !suggestionPhaseIsComplete);
  } finally {
    hideLoader('initial-loader');
    hideLoader('generation-loader');
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// --- Event Listeners ---
sendBtn.addEventListener('click', handleSend);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${inputEl.scrollHeight}px`;
});