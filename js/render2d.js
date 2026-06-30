// 2D canvas renderer (fallback)
export function createRenderer2D({ onSquareClick }){
  let board=null, ctx=null;
  let TILE=0, FILES=9, RANKS=9;
  let lastPos=null, lastView={};
  let flash=null;             // illegal flash square

  function init({files, ranks}={}){
    FILES = files||9; RANKS = ranks||9;
    board = document.getElementById('board');
    if(!board) return false;
    ctx = board.getContext('2d', {alpha:false});
    board.style.display = '';
    board.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    fit();
    draw(null, {});          // paint empty board
    return true;
  }

  function setDims(files, ranks){
    FILES = files||FILES; RANKS = ranks||RANKS;
    fit();
    rerender();
  }

  function fit(){
    if(!board) return;
    const dpr = window.devicePixelRatio||1;
    const rect = board.getBoundingClientRect();
    const px = Math.round(Math.min(rect.width, rect.height)*dpr);
    if(px<=0) return;
    board.width=px; board.height=px; TILE=px/FILES;
    ctx.setTransform(1,0,0,1,0,0);
  }

  function onResize(){ fit(); rerender(); }
  function rerender(){ draw(lastPos, lastView); }

  function onClick(e){
    const rect = board.getBoundingClientRect();
    const s = rect.width/FILES;
    const f = Math.floor((e.clientX-rect.left)/s);
    const r = (RANKS-1) - Math.floor((e.clientY-rect.top)/s);
    if(f<0||f>=FILES||r<0||r>=RANKS) return;
    onSquareClick(f, r);
  }

  function render(pos, view){
    lastPos = pos; lastView = view||{};
    draw(pos, lastView);
  }

  function draw(pos, view){
    if(!ctx) return;
    const {sel=null, pending=null, frozen=new Set(), lastMove=null, check=false, tableMode=false} = view||{};

    // board tiles
    for(let r=0;r<RANKS;r++){
      for(let f=0;f<FILES;f++){
        const light=((f+r)&1)===0;
        ctx.fillStyle=light?'#ddd':'#666';
        ctx.fillRect(f*TILE,(RANKS-1-r)*TILE,TILE,TILE);
      }
    }

    if(lastMove){
      ctx.fillStyle='rgba(255,215,0,.22)';
      for(const [lf,lr] of [[lastMove.ff,lastMove.fr],[lastMove.tf,lastMove.tr]]){
        if(Number.isInteger(lf)&&Number.isInteger(lr)) ctx.fillRect(lf*TILE,(RANKS-1-lr)*TILE,TILE,TILE);
      }
    }

    if(pos && check && pos.kingPos && pos.kingPos[pos.sideToMove]){
      const [kf,kr]=pos.kingPos[pos.sideToMove];
      if(Number.isInteger(kf)&&Number.isInteger(kr)){
        ctx.fillStyle='rgba(220,40,40,.40)';
        ctx.fillRect(kf*TILE,(RANKS-1-kr)*TILE,TILE,TILE);
      }
    }

    if(frozen && frozen.size){
      ctx.fillStyle='rgba(64,156,255,0.28)';
      frozen.forEach(key=>{
        const [f,r]=key.split(',').map(n=>+n);
        ctx.fillRect(f*TILE,(RANKS-1-r)*TILE,TILE,TILE);
      });
    }

    if(sel){
      ctx.fillStyle='rgba(255,255,0,.22)';
      ctx.fillRect(sel.f*TILE,(RANKS-1-sel.r)*TILE,TILE,TILE);
    }

    const legal = view && view.legalTargets;
    if(legal && legal.size){
      ctx.fillStyle='rgba(46,125,50,.5)';
      legal.forEach(key=>{
        const [f,r]=key.split(',').map(n=>+n);
        ctx.beginPath();
        ctx.arc(f*TILE+TILE/2, (RANKS-1-r)*TILE+TILE/2, TILE*0.14, 0, Math.PI*2);
        ctx.fill();
      });
    }

    if(flash){
      ctx.fillStyle='rgba(255,42,42,.55)';
      ctx.fillRect(flash.f*TILE,(RANKS-1-flash.r)*TILE,TILE,TILE);
    }

    if(pos && pos.board){
      for(let r=0;r<RANKS;r++){
        for(let f=0;f<FILES;f++){
          const code=pos.board?.[f]?.[r];
          if(!code) continue;
          if(pending && pending.ff===f && pending.fr===r) continue;
          if(pending && pending.tf===f && pending.tr===r) continue;
          drawPiece(code,f,r,tableMode);
        }
      }
      if(pending){
        drawPiece(pending.pc, pending.tf, pending.tr, tableMode);
      }
    }
  }

  function drawPiece(code,f,r,tableMode){
    const x=f*TILE+TILE/2, y=(RANKS-1-r)*TILE+TILE/2;

    ctx.fillStyle=code[0]==='w'?'#fff':'#000';
    ctx.beginPath(); ctx.arc(x,y,TILE*0.34,0,Math.PI*2); ctx.fill();

    ctx.fillStyle=code[0]==='w'?'#000':'#fff';
    ctx.font=Math.floor(TILE*0.30)+'px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';

    ctx.save();
    ctx.translate(x, y);
    if(tableMode && code[0]==='b'){ ctx.rotate(Math.PI); }
    ctx.fillText(code[1], 0, 1);
    ctx.restore();
  }

  // move animation stubs
  function animateMove(){ return Promise.resolve(); }
  function previewMove(){ return Promise.resolve(); }
  function commitPreview(){}
  function cancelPreview(){}
  function celebrate(){ return Promise.resolve(); }
  function reset(){}

  function flashIllegal(f,r){
    flash={f,r};
    rerender();
    setTimeout(()=>{ flash=null; rerender(); }, 360);
  }

  function destroy(){
    if(board) board.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
  }

  return { kind:'2d', init, setDims, resize:fit, render,
           previewMove, commitPreview, cancelPreview, animateMove,
           flashIllegal, celebrate, reset, destroy };
}
