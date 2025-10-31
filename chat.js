(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JuliaChatModule = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  if (window.__juliaChatBooted) return window.JuliaChatModule || { init: function(){} };
  window.__juliaChatBooted = true;

  const playerInfo = {};
  let ownId = null;
  let wsRef = null;
  let isInputOpen = false;
  const partialStrBySender = new Map();

  let __wsPollTimer = null;
  let __sendQueue = [];

  const now = () => Date.now();

  function encodeSurrogate(cp){
    if (cp <= 0xFFFF) return '\\u' + cp.toString(16).toUpperCase().padStart(4,'0');
    const v = cp - 0x10000;
    const hi = 0xD800 + (v >> 10);
    const lo = 0xDC00 + (v & 0x3FF);
    return '\\u' + hi.toString(16).toUpperCase().padStart(4,'0') + '\\u' + lo.toString(16).toUpperCase().padStart(4,'0');
  }

  function encodeTransport(str){
    let out = '';
    for (const ch of String(str||'')){
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

  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position:'fixed', top:'10px', left:'20px', maxWidth:'40vw', zIndex:'2147483647', pointerEvents:'none', fontFamily:'Play, system-ui, sans-serif', fontSize:'12pt', lineHeight:'1.25', color:'white', textShadow:'0 1px 2px rgba(0,0,0,.6)', filter:'drop-shadow(0 2px 3px rgba(0,0,0,.35))' });
  const list = document.createElement('div'); overlay.appendChild(list);
  const MAX_LINES = 10;

  function pushOverlayLine(who, text, hue) {
    const row = document.createElement('div');
    row.style.margin='2px 0';
    row.style.opacity='1';
    row.style.transition='opacity .4s ease';
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

  const inputWrap = document.createElement('div');
  Object.assign(inputWrap.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', zIndex:'2147483647', display:'none', gap:'8px', alignItems:'center', background:'rgba(0,0,0,.55)', padding:'8px 10px', borderRadius:'8px', backdropFilter:'blur(4px)', boxShadow:'0 2px 8px rgba(0,0,0,.35)' });
  const hint = document.createElement('span'); hint.textContent = 'Alt+C — open/close • Enter — send'; Object.assign(hint.style,{ color:'#ddd', fontFamily:'Play, system-ui, sans-serif', fontSize:'11pt', userSelect:'none' });
  const input = document.createElement('input'); Object.assign(input,{ type:'text', placeholder:'Enter your message...', spellcheck:false, autocomplete:'off' }); Object.assign(input.style,{ width:'360px', maxWidth:'64vw', outline:'none', border:'1px solid rgba(255,255,255,.2)', background:'rgba(0,0,0,.4)', color:'white', padding:'8px 10px', borderRadius:'6px', fontSize:'12pt', fontFamily:'Play, system-ui, sans-serif' });
  const sendBtn = document.createElement('button'); sendBtn.textContent='Send'; Object.assign(sendBtn.style,{ border:'none', padding:'8px 12px', borderRadius:'6px', color:'white', background:'hsl(310,80%,50%)', cursor:'pointer', fontSize:'12pt', fontFamily:'Play, system-ui, sans-serif' });
  inputWrap.appendChild(hint); inputWrap.appendChild(input); inputWrap.appendChild(sendBtn);

  function mountUI(){ if(!document.body) return; if(!document.getElementById('juliaChatOverlay')) document.body.appendChild(overlay); if(!document.getElementById('juliaChatInput')){ inputWrap.id='juliaChatInput'; document.body.appendChild(inputWrap);} }
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

  function locateSocket() {
    try {
      const settings = window.module?.exports?.settings;
      if (!settings) return null;
      const modeNode = Object.values(settings).find(v => v && v.mode);
      if (!modeNode) return null;
      const hit = Object.values(modeNode).find(v => v && v.socket && typeof v.socket.send === 'function');
      return hit?.socket || null;
    } catch { return null; }
  }

  function scanForSocket(obj, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return null;
    seen.add(obj);
    if (typeof obj.send === 'function' && typeof obj.addEventListener === 'function' && typeof obj.readyState === 'number') return obj;
    for (const v of Object.values(obj)) {
      const s = scanForSocket(v, seen);
      if (s) return s;
    }
    return null;
  }

  function getOpenSocket(){
    if (wsRef && wsRef.readyState === WebSocket.OPEN) return wsRef;
    let s = locateSocket();
    if (!s) s = scanForSocket(window.module?.exports);
    if (s) wsRef = s;
    if (wsRef && wsRef.readyState === WebSocket.OPEN) return wsRef;

    if (!__wsPollTimer) {
      __wsPollTimer = setInterval(() => {
        let c = locateSocket();
        if (!c) c = scanForSocket(window.module?.exports);
        if (c) wsRef = c;
        if (wsRef && wsRef.readyState === WebSocket.OPEN) {
          clearInterval(__wsPollTimer);
          __wsPollTimer = null;
          while (__sendQueue.length) {
            const pkt = __sendQueue.shift();
            try { wsRef.send(JSON.stringify({ name:'say', data:pkt })); } catch {}
          }
        }
      }, 250);
    }
    return null;
  }

  const MIN_INTERVAL_MS = 350;

  function chunkEncoded(s){
    const out=[]; let i=0;
    while(i<s.length){
      const r=s.length-i;
      if(r>4){ out.push('!'+s.slice(i,i+3)+'!'); i+=3; }
      else { out.push('!'+s.slice(i)); i=s.length; }
    }
    return out;
  }

  function sendChunkedEscaped(text){
    const enc = encodeTransport(text);
    const parts = chunkEncoded(enc);
    let i=0; (function step(){ if(i>=parts.length) return; wsSendSay(parts[i++]); setTimeout(step, MIN_INTERVAL_MS); })();
  }

  function wsSendSay(packet){
    const sock = getOpenSocket();
    if(!sock){ __sendQueue.push(packet); return false; }
    try{ sock.send(JSON.stringify({name:'say',data:packet})); return true; }
    catch{ __sendQueue.push(packet); return false; }
  }

  function trySendFromInput(){
    const text=input.value.trim();
    if(!text) return;
    sendChunkedEscaped(text);
    input.value='';
  }

  input.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.code==='Enter'){ e.preventDefault(); trySendFromInput(); } else if(e.key==='Escape'||e.code==='Escape'){ e.preventDefault(); closeChatInput(); } });
  sendBtn.addEventListener('click', trySendFromInput);

  function initSocket(ws){
    ws.addEventListener('message',(ev)=>{
      if (typeof ev.data!=='string') return;
      let msg; try{ msg=JSON.parse(ev.data);}catch{ return; }
      if (msg?.name==='entered' && msg.data?.shipid!=null){ ownId=msg.data.shipid>>>0; }
      if (msg?.name==='player_name' && msg.data){ const d=msg.data; playerInfo[d.id]={ name:d.player_name, hue:d.hue, custom:d.custom||{} }; }
    });

    ws.addEventListener('message',(ev)=>{
      if(!(ev.data instanceof Blob)) return;
      ev.data.arrayBuffer().then((ab)=>{
        const u8=new Uint8Array(ab);
        if(u8[0]!==240) return;
        const senderId=u8[1]>>>0;
        let payload=u8.subarray(2);
        if(payload.length===0 || payload[0]!==0x21) return;
        const continues=payload[payload.length-1]===0x21;
        let s='';
        for(let i=1;i<payload.length-(continues?1:0);i++) s+=String.fromCharCode(payload[i]);
        const prev=partialStrBySender.get(senderId)||'';
        const next=prev+s;
        if(continues){
          partialStrBySender.set(senderId,next);
        }else{
          const text = decodeTransport(next);
          const who=(ownId!=null && senderId===ownId)?'You':(playerInfo[senderId]?.name||`ID${senderId}`);
          const hue=(ownId!=null && senderId===ownId)?310:playerInfo[senderId]?.hue;
          if(text.trim().length>0) pushOverlayLine(who, text, hue);
          partialStrBySender.delete(senderId);
        }
      }).catch(()=>{});
    });
  }

  function wrapWS(){
    const OrigWS=window.WebSocket;
    if (!OrigWS || OrigWS.__juliaWrapped) return;
    function W(...args){
      const ws=new OrigWS(...args);
      ws.addEventListener('open', ()=>{ wsRef = ws; });
      initSocket(ws);
      return ws;
    }
    W.prototype=OrigWS.prototype; Object.setPrototypeOf(W, OrigWS); W.__juliaWrapped = true; window.WebSocket = W;
  }

  function init(){
    mountUI();
    wrapWS();
    const intv=setInterval(()=>{ mountUI(); if(document.body) clearInterval(intv); },50);
  }

  init();

  return { init };
}));
