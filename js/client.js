// Controller (render-agnostic)
import { createRenderer2D } from './render2d.js';
import { createRendererGL } from './renderGL.js';

let FILES=9, RANKS=9;
let game=null, sideToMove='w';
let whiteTime=600, blackTime=600, timer=null;
let lastPos=null;
let lastMove=null;          // last confirmed move
let announcedEnd=false;     // game-over announced once
let isSending=false;
let showConfirmUI=false;
let tableMode=false;
let hasEnded=false;
let endingInFlight=false;
let mode='joke';
let renderer=null;
let sel=null;               // selection
let pending=null;           // pending move
let promoMenuEl=null;
let awaitingPromotion=false;

const FUN_ILLEGAL = [
  "whoa there, trickster 🃏",
  "nice try, but nope",
  "the board says 'nah'",
  "that move's a mirage",
  "jokes on us—can't do that"
];

window.onload=init;

// renderer selection
function webglAvailable(){
  try{
    const c=document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl')||c.getContext('experimental-webgl')));
  }catch(_){ return false; }
}
function makeRenderer(){
  if(webglAvailable()){
    try{
      const r=createRendererGL({ onSquareClick });
      if(r.init({files:FILES, ranks:RANKS})) return r;
    }catch(e){ console.warn('GL renderer unavailable, using 2D:', e); }
  }
  const r2=createRenderer2D({ onSquareClick });
  r2.init({files:FILES, ranks:RANKS});
  return r2;
}

function currentView(){
  return {
    sel: sel ? {f:sel.f, r:sel.r} : null,
    pending,
    frozen: lastPos ? getFrozenSet(lastPos) : new Set(),
    lastMove,
    check: !!(lastPos && lastPos.check),
    tableMode,
    legalTargets: (sel && sel.loaded) ? sel.targets : null
  };
}
function redraw(){
  if(renderer) renderer.render(lastPos, currentView());
  updateConfirmBar();
}
function updateConfirmBar(){
  const bar=document.getElementById('confirm-bar');
  if(!bar) return;
  if(pending){
    if(tableMode && sideToMove==='b') bar.classList.add('top'); else bar.classList.remove('top');
    bar.style.display = showConfirmUI ? 'flex' : 'none';
  }else{
    bar.style.display='none';
  }
}

async function init(){
  injectUIHelpers();
  renderer = makeRenderer();

  window.addEventListener('resize', ()=>{ removePromoMenu(); });

  await ensureGameId();
  await poll();

  hydrateFromServer();
  maybeStartClock();

  document.addEventListener('click', (e)=>{
    if(!promoMenuEl) return;
    const t=e.target;
    if (promoMenuEl.contains(t)) return;
    if (t.closest && (t.closest('.board-wrap') || t.closest('#confirm-bar') || t.closest('#controls-wrap') || t.closest('#mode-wrap') || t.closest('#modal-shade'))) return;
    removePromoMenu();
  });
}

function injectUIHelpers(){
  if(!document.getElementById('toast-bin-bottom')){
    const binB=document.createElement('div'); binB.id='toast-bin-bottom';
    const binT=document.createElement('div'); binT.id='toast-bin-top';
    document.body.appendChild(binB); document.body.appendChild(binT);

    const bar=document.createElement('div'); bar.id='confirm-bar';
    const bYes=document.createElement('button'); bYes.className='yes'; bYes.textContent='Confirm';
    const bNo=document.createElement('button'); bNo.className='no'; bNo.textContent='Cancel';
    bYes.onclick=(ev)=>{ ev.stopPropagation(); confirmMove(ev); };
    bNo.onclick=(ev)=>{ ev.stopPropagation(); cancelPreview(); };
    bar.appendChild(bNo); bar.appendChild(bYes);
    document.body.appendChild(bar);

    const topHost=document.getElementById('black-top-clock');
    if(topHost && !document.getElementById('blackTopTime')){
      const t=document.createElement('div'); t.className='time'; t.id='blackTopTime'; t.textContent='10:00';
      topHost.appendChild(t);
    }

    const menuHost = document.getElementById('menu') || null;
    const controlsWrap = document.createElement('div');
    controlsWrap.id = 'controls-wrap';
    const modeWrap = document.createElement('div');
    modeWrap.id = 'mode-wrap';
    const modeLbl = document.createElement('label');
    modeLbl.htmlFor = 'modeSelect';
    modeLbl.textContent = 'Mode: ';
    const selEl = document.createElement('select');
    selEl.id = 'modeSelect';
    const optJ = document.createElement('option'); optJ.value='joke';    optJ.textContent='Chess is a Joke (9x9)';
    const optC = document.createElement('option'); optC.value='classic'; optC.textContent='Classic (8x8)';
    selEl.appendChild(optJ); selEl.appendChild(optC);
    modeWrap.appendChild(modeLbl); modeWrap.appendChild(selEl);

    const toggleWrap = document.createElement('div');
    toggleWrap.id = 'table-toggle';
    const btn = document.createElement('button');
    btn.id = 'btnTableMode';
    btn.textContent = 'Table Mode: OFF';
    btn.onclick = toggleTableMode;
    toggleWrap.appendChild(btn);

    controlsWrap.appendChild(modeWrap);
    controlsWrap.appendChild(toggleWrap);

    if (menuHost) {
      menuHost.appendChild(controlsWrap);
    } else {
      const clockHost = document.getElementById('clock');
      if (clockHost) clockHost.insertAdjacentElement('afterend', controlsWrap);
      else document.body.appendChild(controlsWrap);
    }
  }
}

function syncModeSelector(){
  const selEl=document.getElementById('modeSelect');
  if(!selEl) return;
  selEl.value = (mode==='classic' ? 'classic' : 'joke');
}

function toast(msg, ms=1600, preferTop=null){
  const useTop = tableMode
    ? (preferTop!==null ? preferTop : (sideToMove==='b'))
    : false;
  const bin=document.getElementById(useTop?'toast-bin-top':'toast-bin-bottom');
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  bin.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),250); }, ms);
}

function confirmDialog(text, onYes){
  const existing = document.getElementById('modal-shade');
  if (existing) existing.remove();

  const shade=document.createElement('div'); shade.id='modal-shade';
  const modal=document.createElement('div'); modal.id='modal';
  const p=document.createElement('div'); p.textContent=text;
  const row=document.createElement('div'); row.className='row';
  const ok=document.createElement('button'); ok.className='ok'; ok.textContent='Yes';
  const cancel=document.createElement('button'); cancel.className='cancel'; cancel.textContent='Cancel';

  ok.onclick=(ev)=>{ ev.stopPropagation(); shade.remove(); onYes&&onYes(); };
  cancel.onclick=(ev)=>{ ev.stopPropagation(); shade.remove(); };

  row.appendChild(cancel); row.appendChild(ok);
  modal.appendChild(p); modal.appendChild(row); shade.appendChild(modal);
  document.body.appendChild(shade);
}

async function ensureGameId(){
  const params=new URLSearchParams(location.search);
  const existing=params.get('game');
  if(existing && existing.trim()!==''){ game=existing.trim(); return; }
  const res=await fetch('/engine/new_game.php',{method:'POST',cache:'no-store'});
  const js=await res.json().catch(()=>null);
  if(!js||!js.ok||!js.game){ toast('could not start game', 1600, false); throw new Error('new_game failed'); }
  game=js.game;
  const url=new URL(location.href); url.searchParams.set('game',game);
  history.replaceState(null,'',url.toString());
}

function getFrozenSet(pos){
  const S=new Set();
  const add=(f,r)=>{
    if(Number.isInteger(f)&&Number.isInteger(r) && f>=0 && f<FILES && r>=0 && r<RANKS){
      S.add(f+','+r);
    }
  };
  if(Array.isArray(pos?.frozen)){
    pos.frozen.forEach(e=>{ if(e&&typeof e==='object') add(e.f ?? e.file ?? e.x, e.r ?? e.rank ?? e.y); });
  }else if(pos && typeof pos.frozen==='object'){
    Object.values(pos.frozen).forEach(e=>{ if(e&&typeof e==='object') add(e.f ?? e.file, e.r ?? e.rank); });
  }
  if(Array.isArray(pos?.flaked)){
    pos.flaked.forEach(e=>{ if(e&&typeof e==='object') add(e.f ?? e.file, e.r ?? e.rank); });
  }
  if(Array.isArray(pos?.jokerFrozen)){
    pos.jokerFrozen.forEach(e=>{ if(e&&typeof e==='object') add(e.f, e.r); });
  }
  return S;
}

// selection + legality
async function fetchLegalMoves(ff,fr){
  try{
    const res=await fetch(`/engine/legal_moves.php?game=${encodeURIComponent(game)}&ff=${ff}&fr=${fr}`,{cache:'no-store'});
    const js=await res.json();
    const set=new Set();
    if(js && js.ok && Array.isArray(js.moves)) js.moves.forEach(([tf,tr])=> set.add(tf+','+tr));
    return set;
  }catch{ return new Set(); }
}

function selectPiece(f,r){
  const pc=lastPos.board?.[f]?.[r];
  const s={f, r, pc, targets:new Set(), loaded:false, promise:null};
  sel=s; pending=null; showConfirmUI=false;
  redraw();
  s.promise = fetchLegalMoves(f,r).then(set=>{ if(sel===s){ s.targets=set; s.loaded=true; redraw(); } return set; });
}

// resolve castling rook gesture to king destination
function resolveTarget(s, f, r, code){
  if(s.pc[1]==='K' && code && code[0]===s.pc[0] && code[1]==='R' && r===s.r){
    const dir = (f>s.f) ? 1 : -1;
    for(const key of s.targets){
      const [tf,tr]=key.split(',').map(Number);
      if(tr===s.r && Math.sign(tf-s.f)===dir && Math.abs(tf-s.f)>=2) return {f:tf, r:tr};
    }
  }
  return {f, r};
}

function clearPreview(){
  if(pending){ try{ renderer && renderer.cancelPreview && renderer.cancelPreview(); }catch(_){} }
  pending=null; showConfirmUI=false;
}
function clearPreviewAndSel(){
  clearPreview();
  sel=null;
  redraw();
}

function setPendingPreview(t){
  if(pending && pending.tf===t.f && pending.tr===t.r) return;   // already previewing
  if(pending){ try{ renderer && renderer.cancelPreview && renderer.cancelPreview(); }catch(_){} }
  pending={ ff:sel.f, fr:sel.r, tf:t.f, tr:t.r, pc:sel.pc };
  showConfirmUI=true;
  const anim=buildAnimMove(pending.ff,pending.fr,pending.tf,pending.tr,pending.pc,null);
  try{ if(renderer && renderer.previewMove) renderer.previewMove(anim); }catch(_){}
  redraw();
}

// board square click
async function onSquareClick(f, r){
  if(!lastPos || isSending) return;
  if(lastPos.status && lastPos.status!=='ongoing') return;
  if(f<0||f>=FILES||r<0||r>=RANKS) return;

  const code = lastPos.board?.[f]?.[r] || null;

  if(sel){
    // deselect
    if(sel.f===f && sel.r===r){ clearPreviewAndSel(); return; }

    // reselect another piece
    const isCastleGesture = (sel.pc[1]==='K' && code && code[0]===sel.pc[0] && code[1]==='R' && r===sel.r);
    if(code && code[0]===sideToMove && !isCastleGesture){
      if(getFrozenSet(lastPos).has(f+','+r)){ toast('that piece is frozen 🧊'); return; }
      clearPreview();
      selectPiece(f,r);
      return;
    }

    // target: pre-validate
    if(!sel.loaded && sel.promise){ await sel.promise; }
    const t=resolveTarget(sel,f,r,code);
    if(sel.targets.has(t.f+','+t.r)){
      setPendingPreview(t);
    }else{
      try{ renderer && renderer.flashIllegal && renderer.flashIllegal(t.f, t.r); }catch(_){}
    }
    return;
  }

  // select a piece
  if(code && code[0]===sideToMove){
    if(getFrozenSet(lastPos).has(f+','+r)){ toast('that piece is frozen 🧊'); return; }
    selectPiece(f,r);
  }
}

function needsPromotion(piece,toR){
  if(!piece || piece[1]!=='P') return false;
  const side = piece[0];
  const targetRank = (side==='w') ? (RANKS-1) : 0;
  return toR === targetRank;
}

function promotionChoices(){
  // classic vs joke
  return (mode==='classic') ? ['Q','R','B','N'] : ['Q','R','B','N','J'];
}

// promotion menu
function showPromoMenu(side){
  removePromoMenu();
  const wrap=document.querySelector('.board-wrap');
  const rect=wrap ? wrap.getBoundingClientRect() : {left:window.innerWidth/2, top:window.innerHeight/2, width:0, height:0};

  const menu=document.createElement('div');
  menu.id='promo-menu';
  menu.dataset.dir='down';
  menu.style.left = Math.round(rect.left + rect.width/2)+'px';
  menu.style.top  = Math.round(rect.top  + rect.height*0.30)+'px';
  menu.style.transform = 'translateX(-50%)';

  for(const ch of promotionChoices()){
    const opt=document.createElement('button');
    opt.className='promo-opt';
    opt.textContent=ch;
    opt.onclick=async (ev)=>{
      ev.stopPropagation();
      if(!pending) { removePromoMenu(); return; }
      pending.promo = ch;
      removePromoMenu();
      await sendMove();
    };
    menu.appendChild(opt);
  }

  document.body.appendChild(menu);
  promoMenuEl = menu;
}

function removePromoMenu(){
  if(promoMenuEl && promoMenuEl.parentNode){
    promoMenuEl.parentNode.removeChild(promoMenuEl);
  }
  promoMenuEl=null;
  awaitingPromotion=false;
}

async function confirmMove(ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  if(!pending || isSending) return;

  if(needsPromotion(pending.pc, pending.tr) && !pending.promo){
    showPromoMenu(pending.pc[0]);
    awaitingPromotion=true;
    return;
  }

  await sendMove();
}

// move descriptor for animation
function buildAnimMove(ff,fr,tf,tr,pc,promo){
  const m={ff,fr,tf,tr,pc,promo:promo||null,capture:false,rook:null};
  const targetBefore = lastPos?.board?.[tf]?.[tr];
  if(targetBefore && targetBefore[0]!==pc[0]) m.capture=true;   // capture
  // castling rook slide
  if(pc[1]==='K' && Math.abs(tf-ff)>=2){
    const dir = (tf>ff)?1:-1;
    m.rook = { ff:(dir>0?FILES-1:0), fr:fr, tf:tf-dir, tr:tr };
    m.capture=false;
  }
  return m;
}

async function sendMove(){
  if(!pending || isSending) return;
  isSending = true;
  showConfirmUI = false;
  updateConfirmBar();

  const {ff,fr,tf,tr,promo,pc}=pending;
  const anim = buildAnimMove(ff,fr,tf,tr,pc,promo);

  const form=new FormData();
  form.append('game',game);
  form.append('ff',ff); form.append('fr',fr);
  form.append('tf',tf); form.append('tr',tr);
  if(promo) form.append('promo', String(promo));

  let ok=false, js=null;
  try{
    const res=await fetch('/engine/validate_move.php',{method:'POST',body:form});
    js=await res.json();
    ok = (js && js.status==='success');
  }catch{}

  if(!ok && js && (js.message||'').toLowerCase().includes('promotion')){
    showPromoMenu(pc[0]);
    isSending=false;
    return;
  }

  if(!ok){
    // revert preview on rejection
    try{ renderer && renderer.cancelPreview && renderer.cancelPreview(); }catch(_){}
    pending=null; sel=null;
    toast((js && js.message) ? js.message : FUN_ILLEGAL[Math.floor(Math.random()*FUN_ILLEGAL.length)]);
    await poll();
    isSending=false;
    return;
  }

  sideToMove=js.data?.sideToMove || sideToMove;
  lastMove={ff,fr,tf,tr};

  // finalize preview
  try{ if(renderer && renderer.commitPreview) renderer.commitPreview(anim); }catch(_){}
  pending=null; sel=null;
  updateConfirmBar();

  if(js.data && js.data.status && js.data.status!=='ongoing'){
    hasEnded = true;
    stopClock();
    const reason = js.data.reason || 'checkmate';
    const winner = js.data.winner || null;
    await endGame(reason, winner, whiteTime, blackTime);
  }

  // refresh state
  await poll();
  isSending=false;
}

function cancelPreview(){
  clearPreviewAndSel();
  removePromoMenu();
}

function hydrateFromServer(){
  if(!lastPos) return;

  mode = (lastPos.mode==='classic') ? 'classic' : 'joke';
  syncModeSelector();

  const newFiles = (Array.isArray(lastPos.board) ? lastPos.board.length : FILES) | 0;
  const newRanks = (Array.isArray(lastPos.board?.[0]) ? lastPos.board[0].length : RANKS) | 0;
  if(newFiles>0 && newRanks>0 && (newFiles!==FILES || newRanks!==RANKS)){
    FILES=newFiles; RANKS=newRanks;
    if(renderer && renderer.setDims) renderer.setDims(FILES, RANKS);
  }

  hasEnded = !!(lastPos.endedAt) || (lastPos.status && lastPos.status!=='ongoing');

  if(hasEnded){
    stopClock();
    if(Number.isInteger(lastPos.finalWhiteTime)) whiteTime = lastPos.finalWhiteTime;
    if(Number.isInteger(lastPos.finalBlackTime)) blackTime = lastPos.finalBlackTime;
  }
  writeClocks();
}

function maybeStartClock(){
  if(hasEnded) { stopClock(); return; }
  startClock();
}

function startClock(){
  if(timer) clearInterval(timer);
  if(hasEnded) return;
  timer=setInterval(async ()=>{
    if(sideToMove==='w') whiteTime--; else blackTime--;
    if(whiteTime<0) whiteTime=0; if(blackTime<0) blackTime=0;
    writeClocks();

    if(!hasEnded && (whiteTime===0 || blackTime===0) && lastPos && lastPos.status==='ongoing'){
      const loser = (whiteTime===0)?'w':'b';
      const winner = (loser==='w')?'b':'w';
      hasEnded = true;
      stopClock();
      await endGame('timeout', winner, whiteTime, blackTime);
      // load timeout result
      await poll();
    }
  },1000);
}
function stopClock(){
  if(timer){ clearInterval(timer); timer=null; }
}
function writeClocks(){
  const wt=document.getElementById('whiteTime');
  const bt=document.getElementById('blackTime');
  const btt=document.getElementById('blackTopTime');
  if(wt) wt.textContent=format(whiteTime);
  if(bt) bt.textContent=format(blackTime);
  if(btt) btt.textContent=format(blackTime);
}
function format(s){
  const v = Math.max(0, s|0);
  const m=Math.floor(v/60), sec=(v%60).toString().padStart(2,'0');
  return m+':'+sec;
}

async function endGame(reason, winner, finalW, finalB){
  if(endingInFlight) return;
  endingInFlight = true;
  try{
    const form=new FormData();
    form.append('game', game);
    if(reason) form.append('reason', reason);
    if(winner!==null && winner!==undefined) form.append('winner', winner);
    form.append('finalWhiteTime', String((finalW|0)));
    form.append('finalBlackTime', String((finalB|0)));
    await fetch('/engine/end_game.php', {method:'POST', body: form});
  }catch(e){
  }finally{
    endingInFlight = false;
  }
}

function gameOverMessage(pos){
  if(!pos) return 'Game over';
  if(pos.status==='checkmate') return `Checkmate — ${(pos.winner==='w'?'White':'Black')} wins`;
  if(pos.reason==='timeout'){
    const w = pos.winner==='w'?'White':pos.winner==='b'?'Black':null;
    return w ? `Time out — ${w} wins` : 'Time out';
  }
  if(pos.status==='draw' && pos.reason==='stalemate')    return 'Draw — stalemate';
  if(pos.status==='draw' && pos.reason==='50-move')      return 'Draw — 50-move rule';
  if(pos.status==='draw' && pos.reason==='insufficient') return 'Draw — insufficient material';
  if(pos.status && pos.status!=='ongoing')               return 'Game over';
  return 'Game over';
}

// end-of-game announcement
function announceGameOver(pos){
  if(announcedEnd) return;
  if(!pos || !pos.status || pos.status==='ongoing') return;
  announcedEnd = true;
  hasEnded = true;
  stopClock();

  const msg = gameOverMessage(pos);
  const loser = pos.winner ? (pos.winner==='w'?'b':'w') : null;
  const preferTop = (tableMode && loser==='b') ? true : (tableMode ? false : null);
  toast(msg, 2600, preferTop);
  showGameOverBanner(msg);

  // celebration
  try{ if(renderer && renderer.celebrate && pos.winner) renderer.celebrate(pos.winner); }catch(_){}
}

function showGameOverBanner(msg){
  const existing=document.getElementById('gameover-shade');
  if(existing) existing.remove();

  const shade=document.createElement('div'); shade.id='gameover-shade';
  const panel=document.createElement('div'); panel.id='gameover-panel';
  const title=document.createElement('div'); title.className='go-title'; title.textContent=msg;
  const row=document.createElement('div'); row.className='go-row';
  const again=document.createElement('button'); again.className='go-again'; again.textContent='New Game';
  const dismiss=document.createElement('button'); dismiss.className='go-dismiss'; dismiss.textContent='Dismiss';

  again.onclick=(ev)=>{ ev.stopPropagation(); shade.remove(); newGame(); };
  dismiss.onclick=(ev)=>{ ev.stopPropagation(); shade.remove(); };

  row.appendChild(dismiss); row.appendChild(again);
  panel.appendChild(title); panel.appendChild(row); shade.appendChild(panel);
  document.body.appendChild(shade);
}

async function poll(){
  const res=await fetch('/engine/get_state.php?game='+encodeURIComponent(game),{cache:'no-store'});
  if(!res.ok) return;
  lastPos=await res.json();
  sideToMove=lastPos.sideToMove||sideToMove;

  hydrateFromServer();

  redraw();

  if(hasEnded) announceGameOver(lastPos);
}

function toggleTableMode(){
  tableMode = !tableMode;
  const b=document.getElementById('btnTableMode');
  if(b) b.textContent = 'Table Mode: ' + (tableMode?'ON':'OFF');
  applyTableModeUI();
  redraw();
}
function applyTableModeUI(){
  document.body.classList.toggle('table-mode', tableMode);

  const topHost=document.getElementById('black-top-clock');
  if(topHost) topHost.style.display = tableMode ? '' : 'none';

  const blackBottom = document.getElementById('blackBottom') ||
                      (document.getElementById('blackTime') ? document.getElementById('blackTime').parentElement : null);
  if(blackBottom) blackBottom.style.display = tableMode ? 'none' : '';

  document.querySelectorAll('#clock .label').forEach(el=>{
    el.style.display = tableMode ? 'none' : '';
  });
}

async function newGame(){
  const selEl=document.getElementById('modeSelect');
  const chosen = selEl ? selEl.value : (mode || 'joke');

  confirmDialog(`Start a new ${chosen==='classic'?'Classic (8x8)':'Chess is a Joke (9x9)'} game? Current game will be abandoned.`, async ()=>{
    const form=new FormData();
    form.append('mode', chosen);
    const res=await fetch('/engine/new_game.php',{method:'POST', body: form, cache:'no-store'});
    const js=await res.json().catch(()=>null);
    if(!js||!js.ok||!js.game){ toast('could not start game', 1600, false); return; }
    const url=new URL(location.href);
    url.searchParams.set('game', js.game);
    url.searchParams.set('mode', chosen);
    location.replace(url.toString());
  });
}
async function copyLink(){
  try{ await navigator.clipboard.writeText(location.href); toast('link copied', 1400, false); }
  catch{ toast('could not copy', 1400, false); }
}

window.newGame = newGame;
window.copyLink = copyLink;
