/* main.js – vanilla ES module chat frontend */
const BACKEND_URL = '/chat';

const qs = sel => document.querySelector(sel);

const chatEl   = qs('#chat');
const inputEl  = qs('#input');
const sendBtn  = qs('#send');
const themeBtn = qs('#themeToggle');
const themeIcon= qs('#themeIcon');

const THEME_KEY = 'ai-chat-theme';
initTheme();

/* ---------- UI helpers ---------- */
function scrollBottom(){ chatEl.scrollTop = chatEl.scrollHeight; }

function mkMsg(html, cls){
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.innerHTML = html;
  chatEl.appendChild(div);
  enhanceCodeBlocks(div);
  scrollBottom();
  return div;
}

function enhanceCodeBlocks(root){
  root.querySelectorAll('pre code').forEach(code => {
    if(window.hljs) hljs.highlightElement(code);
    // add copy button once
    if(!code.parentElement.querySelector('.copy-btn')){
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent).then(()=>{
          btn.textContent = '✓';
          setTimeout(()=>btn.textContent='Copy',1500);
        });
      });
      code.parentElement.appendChild(btn);
    }
  });
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  setTheme(saved);
  themeBtn.addEventListener('click', () => setTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light'));
}

function setTheme(theme){
  document.body.classList.toggle('light-theme', theme === 'light');
  localStorage.setItem(THEME_KEY, theme);
  themeIcon.innerHTML = theme === 'light'
    ? '<path d="M5.64 17.656L4.22 19.07 1.634 16.485l1.414-1.414zM12 18a6 6 0 100-12 6 6 0 000 12zm8.364-1.515l1.414 1.414-2.586 2.586-1.414-1.414zM22 13h2v-2h-2zm-10 9h2v2h-2zm9-11h2v-2h-2zM2 13H0v-2h2zm9-11h2V0h-2zm6.364 4.343l1.414-1.414 2.586 2.586-1.414 1.414zM4.22 4.93L5.636 3.515 8.22 6.1 6.806 7.515z"/>'
    : '<path d="M12 4.5a1 1 0 011-1h0a1 1 0 010 2h0a1 1 0 01-1-1zm0 14a1 1 0 011-1h0a1 1 0 010 2h0a1 1 0 01-1-1zm7.5-7.5a1 1 0 011 1v0a1 1 0 01-2 0v0a1 1 0 011-1zM4.5 12a1 1 0 011 1v0a1 1 0 01-2 0v0a1 1 0 011-1zm11.036-6.036a1 1 0 011.414 0v0a1 1 0 11-1.414-1.414v0a1 1 0 010 1.414zM6.05 17.95a1 1 0 011.414 0v0a1 1 0 01-1.414 1.414v0a1 1 0 010-1.414zm12.9 0a1 1 0 011.414 0v0a1 1 0 01-1.414 1.414v0a1 1 0 010-1.414zM6.05 6.05a1 1 0 011.414 0v0a1 1 0 01-1.414-1.414v0a1 1 0 010 1.414z"/>';
}

/* ---------- Chat flow ---------- */
sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', e=>{
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }
});
inputEl.addEventListener('input', ()=>{ inputEl.style.height='auto'; inputEl.style.height=inputEl.scrollHeight+'px'; });

async function send(){
  const text = inputEl.value.trim();
  if(!text) return;
  mkMsg(text.replace(/&/g,'&amp;').replace(/</g,'&lt;'), 'user');
  inputEl.value=''; inputEl.style.height='auto';
  sendBtn.disabled = true;

  try{
    const res = await fetch(BACKEND_URL, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ user_message: text }) });
    if(!res.body) throw new Error(res.statusText || 'No body');

    let buf=''; let generatorName=''; let streamMsg;
    const reader = res.body.getReader(); const td = new TextDecoder();
    while(true){
      const {value, done}=await reader.read(); if(done) break;
      buf += td.decode(value, {stream:true});
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for(const line of lines){
        if(!line.trim()) continue;
        const msg = JSON.parse(line);
        const type = msg.type;
        if(type==='suggestions'){
          mkMsg(`**${msg.agent}:**\n\n`+msg.content, 'sugg');
        }else if(type==='generated_code_chunk'){
          if(generatorName!==msg.agent){
            generatorName = msg.agent;
            streamMsg = mkMsg(`**${generatorName}:**\n\n<span class="streaming"></span>`, 'code');
          }
          // append chunk
          const span = streamMsg.querySelector('.streaming');
          span.insertAdjacentHTML('beforebegin', msg.content);
          enhanceCodeBlocks(streamMsg);
          streamMsg.appendChild(span);
          scrollBottom();
        }else if(type==='error'){
          mkMsg(`**Error from ${msg.agent}:**\n\n${msg.content}`, 'error');
        }
      }
    }
    if(streamMsg){ streamMsg.querySelector('.streaming').remove(); }
  }catch(err){
    mkMsg('Client error: '+err.message, 'error');
  }finally{
    sendBtn.disabled = false;
    inputEl.focus();
  }
}
