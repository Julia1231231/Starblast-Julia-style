(function (root, factory) {
                console.log(window.module.exports);
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JuliaChatModule = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

                  console.log(window.module.exports);

  if (window.__juliaChatBooted) return window.JuliaChatModule || { init: function () {} };
  window.__juliaChatBooted = true;

  const MAX_LINES = 10;
  let isInputOpen = false;
  let __sendQueue = [];
                console.log(window.module.exports);

  const overlay = document.createElement('div');
  const list = document.createElement('div'); overlay.appendChild(list);

  const inputWrap = document.createElement('div');
  const hint = document.createElement('span'); hint.textContent = 'Alt+C — open/close • Enter — send';
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', placeholder: 'Enter your message...', spellcheck: false, autocomplete: 'off' });
  const sendBtn = document.createElement('button'); sendBtn.textContent = 'Send';
  inputWrap.appendChild(hint); inputWrap.appendChild(input); inputWrap.appendChild(sendBtn);

  const now = () => Date.now();

  function encodeSurrogate(cp) {
    if (cp <= 0xFFFF) return '\\u' + cp.toString(16).toUpperCase().padStart(4, '0');
    const v = cp - 0x10000;
    const hi = 0xD800 + (v >> 10);
    const lo = 0xDC00 + (v & 0x3FF);
    return '\\u' + hi.toString(16).toUpperCase().padStart(4, '0') + '\\u' + lo.toString(16).toUpperCase().padStart(4, '0');
  }
  function encodeTransport(str) {
    let out = '';
    for (const ch of String(str || '')) {
      const code = ch.codePointAt(0);
      if ((code>=0x30&&code<=0x39)||(code>=0x41&&code<=0x5A)||(code>=0x61&&code<=0x7A)) out += ch;
      else out += encodeSurrogate(code);
      if (code > 0xFFFF) continue;
    }
    return out;
  }
  function decodeTransport(str){
    return str.replace(/\\u([0-9A-Fa-f]{4})/g, (_,h)=>String.fromCharCode(parseInt(h,16)));
  }

  function pushOverlayLine(who, text, hue) {
    const row = document.createElement('div');
    row.style.margin='2px 0'; row.style.opacity='1'; row.style.transition='opacity .4s ease';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = who + ': ';
    nameSpan.style.fontWeight='600';
    nameSpan.style.color = typeof hue==='number' ? `hsl(${hue},80%,60%)` : 'hsl(0,0%,85%)';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = text;
    row.appendChild(nameSpan); row.appendChild(msgSpan); list.appendChild(row);
    while (list.childElementCount > MAX_LINES) list.firstElementChild?.remove();
    const born = now();
    setTimeout(()=>{ if (now()-born>=8000){ row.style.opacity='0'; setTimeout(()=>row.remove(),400);} },8000);
  }

  function anchorOverlayToCanvas() {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    let wrap = document.querySelector('.julia-canvas-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'julia-canvas-wrap';
      const cs = getComputedStyle(canvas);
      Object.assign(wrap.style, {
        position:'fixed', top:'50%', left:'50%', transform:'translate(-50%, -50%)',
        width: cs.width, height: cs.height, pointerEvents:'none', zIndex:'9'
      });
      document.body.appendChild(wrap);
      const syncSize = () => { const cst = getComputedStyle(canvas); wrap.style.width = cst.width; wrap.style.height = cst.height; };
      syncSize();
      const ro = new ResizeObserver(syncSize);
      ro.observe(canvas);
      wrap.__resizeObs = ro;
    }
    if (!document.getElementById('juliaChatOverlay')) wrap.appendChild(overlay);
    Object.assign(overlay.style, {
      position:'absolute', top:'10px', left:'25%', maxWidth:'40vw', zIndex:'10',
      pointerEvents:'none', fontFamily:'Play, system-ui, sans-serif', fontSize:'12pt',
      lineHeight:'1.25', color:'white', textShadow:'0 1px 2px rgba(0,0,0,.6)',
      filter:'drop-shadow(0 2px 3px rgba(0,0,0,.35))'
    });
  }

  function mountUI(){
    if(!document.body) return;
    anchorOverlayToCanvas();
    if (!document.getElementById('juliaChatInput')) {
      inputWrap.id = 'juliaChatInput';
      document.body.appendChild(inputWrap);
    }
    Object.assign(inputWrap.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', zIndex:'2147483647', display:'none', gap:'8px', alignItems:'center', background:'rgba(0,0,0,.55)', padding:'8px 10px', borderRadius:'8px', backdropFilter:'blur(4px)', boxShadow:'0 2px 8px rgba(0,0,0,.35)' });
    Object.assign(hint.style, { color:'#ddd', fontFamily:'Play, system-ui, sans-serif', fontSize:'11pt', userSelect:'none' });
    Object.assign(input.style, { width:'360px', maxWidth:'64vw', outline:'none', border:'1px solid rgba(255,255,255,.2)', background:'rgba(0,0,0,.4)', color:'white', padding:'8px 10px', borderRadius:'6px', fontSize:'12pt', fontFamily:'Play, system-ui, sans-serif' });
    Object.assign(sendBtn.style, { border:'none', padding:'8px 12px', borderRadius:'6px', color:'white', background:'hsl(310,80%,50%)', cursor:'pointer', fontSize:'12pt', fontFamily:'Play, system-ui, sans-serif' });
  }
  function openChatInput(){ mountUI(); inputWrap.style.display='flex'; isInputOpen=true; setTimeout(()=>{ input.focus({preventScroll:true}); input.select(); },0); }
  function closeChatInput(){ inputWrap.style.display='none'; isInputOpen=false; }
  function toggleChatInput(){ isInputOpen?closeChatInput():openChatInput(); }

  document.addEventListener('keydown',(e)=>{
    const target=e.target, ourInput=target===input;
    if (e.altKey && (e.code==='KeyC' || (e.key&&e.key.toLowerCase()==='c'))){ e.preventDefault(); e.stopPropagation(); toggleChatInput(); return; }
    if (ourInput){
      if (e.key==='Enter' || e.code==='Enter'){ e.preventDefault(); e.stopPropagation(); trySendFromInput(); return; }
      if (e.key==='Escape' || e.code==='Escape'){ e.preventDefault(); e.stopPropagation(); closeChatInput(); return; }
      e.stopPropagation();
    } else if (isInputOpen){ e.stopPropagation(); }
  }, true);

  function getSettingsSafe(){
    try { return window.module && window.module.exports && window.module.exports.settings || null; }
    catch { return null; }
  }
  function getSendSocket(){
    try{
      const s = getSettingsSafe(); if (!s) return null;
      const modeNode = Object.values(s).find(v => v && v.mode); if (!modeNode) return null;
      const found = Object.values(modeNode).find(v => v && v.socket && typeof v.socket.send === 'function');
      return found ? found.socket : null;
    }catch{ return null; }
  }

  const MIN_INTERVAL_MS = 100;
  function chunkEncoded(s){ const out=[]; let i=0; while(i<s.length){ const r=s.length-i; if(r>4){ out.push('!'+s.slice(i,i+3)+'!'); i+=3; } else { out.push('!'+s.slice(i)); i=s.length; } } return out; }
  function sendChunkedEscaped(text){ const enc=encodeTransport(text); const parts=chunkEncoded(enc); let i=0; (function step(){ if(i>=parts.length) return; wsSendSay(parts[i++]); setTimeout(step, MIN_INTERVAL_MS); })(); }
  function wsSendSay(packet){ const sock=getSendSocket(); if(!sock || sock.readyState!==WebSocket.OPEN){ __sendQueue.push(packet); return false; } try{ sock.send(JSON.stringify({ name:'say', data:packet })); return true; } catch{ __sendQueue.push(packet); return false; } }
  function trySendFromInput(){ const text=input.value.trim(); if(!text) return; sendChunkedEscaped(text); input.value=''; }
  input.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.code==='Enter'){ e.preventDefault(); trySendFromInput(); } else if(e.key==='Escape'||e.code==='Escape'){ e.preventDefault(); closeChatInput(); } });
  sendBtn.addEventListener('click', trySendFromInput);

  if (typeof window.__juliaSendDrain === 'undefined') {
    window.__juliaSendDrain = setInterval(() => {
      const sock = getSendSocket();
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      while (__sendQueue.length) {
        const p = __sendQueue.shift();
        try { sock.send(JSON.stringify({ name:'say', data:p })); } catch { break; }
      }
    }, 300);
  }

  (function(){
    function getOwnIdSafe(){
      const s = getSettingsSafe(); if (!s) return null;
      try{
        const withUserClient = Object.values(s).find(o => o && o.user_client);
        if (!withUserClient) return null;
        const withStatus = Object.values(withUserClient).find(o => o && o.status && typeof o.status.id === 'number');
        return withStatus ? withStatus.status.id : null;
      }catch{ return null; }
    }
    window.JULIA_CHAT_BRIDGE = window.JULIA_CHAT_BRIDGE || {};
    window.JULIA_CHAT_BRIDGE.show = function(senderId, raw){
      try{
        var own = getOwnIdSafe();
        var txt = (typeof decodeTransport === 'function') ? decodeTransport(raw) : String(raw);
        var who = (own != null && senderId === own) ? 'You' : ('ID' + senderId);
        var hue = (own != null && senderId === own) ? 310 : undefined;
        if (typeof pushOverlayLine === 'function') pushOverlayLine(who, txt, hue);
      }catch{}
    };
  })();

                  console.log(window.module.exports);


  function attachInitToModule(){
    const s = getSettingsSafe();
    if (!s) return;
    try{
      if (!Object.prototype.hasOwnProperty.call(s, '__juliaInit')) {
        Object.defineProperty(s, '__juliaInit', {
          configurable: true, enumerable: false, writable: true,
          value: function(){ try{ window.JuliaChatModule && window.JuliaChatModule.init && window.JuliaChatModule.init(); }catch{} }
        });
      }
    }catch{}
  }

  function init(){
    mountUI();
    attachInitToModule();
  }
                console.log(window.module.exports);

  init();

  return { init };
}));
