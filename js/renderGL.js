// Top-down WebGL renderer
import * as THREE from 'three';

export function createRendererGL({ onSquareClick }){
  let FILES=9, RANKS=9;
  let canvas, renderer, scene, camera, root, boardGroup, pieceGroup, hiGroup, fxGroup;
  let tileMeshes=[];
  const pieceMap = new Map();            // piece map
  let lastPos=null, lastView={};
  let started=false;
  let previewActive=false, preview=null;

  const COL = {
    light: 0xe9e2d0, dark: 0x586071,
    ivory: 0xf1e8d2, charcoal: 0x2f2f37,
    gold: 0xffce3a, red: 0xe0563f, blue: 0x8fd0ff,
    rim: 0x24242b,
    type: { P:0x9aa3ad, N:0x6cc070, B:0x57b6c8, R:0x5b8dd6, Q:0xffce3a, K:0xffce3a, J:0xe0563f }
  };
  const GLYPH = { K:'♚', Q:'♛', R:'♜', B:'♝', N:'♞', P:'♟', J:'🃏' };

  function init({files, ranks}={}){
    try{
      FILES=files||9; RANKS=ranks||9;
      const wrap=document.querySelector('.board-wrap');
      if(!wrap) return false;

      const old=document.getElementById('board');
      if(old) old.style.display='none';
      canvas=document.getElementById('board3d');
      if(!canvas){ canvas=document.createElement('canvas'); canvas.id='board3d'; wrap.appendChild(canvas); }

      renderer=new THREE.WebGLRenderer({canvas, antialias:true, alpha:false});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
      renderer.shadowMap.enabled=true;
      renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.outputColorSpace=THREE.SRGBColorSpace;

      scene=new THREE.Scene();
      scene.background=new THREE.Color(0x202127);

      buildCamera();

      scene.add(new THREE.AmbientLight(0xffffff, 0.72));
      const span=Math.max(FILES,RANKS);
      const key=new THREE.DirectionalLight(0xffffff, 0.85);
      key.position.set(span*0.35, span*1.6, span*0.55);
      key.castShadow=true;
      key.shadow.mapSize.set(1024,1024);
      const d=span;
      key.shadow.camera.left=-d; key.shadow.camera.right=d; key.shadow.camera.top=d; key.shadow.camera.bottom=-d;
      key.shadow.camera.near=0.5; key.shadow.camera.far=span*5;
      scene.add(key);
      const fill=new THREE.DirectionalLight(0xc8d6ff, 0.22);
      fill.position.set(-span*0.5, span*0.8, -span*0.4);
      scene.add(fill);

      root=new THREE.Group(); scene.add(root);
      boardGroup=new THREE.Group(); root.add(boardGroup);
      pieceGroup=new THREE.Group(); root.add(pieceGroup);
      hiGroup=new THREE.Group(); root.add(hiGroup);
      fxGroup=new THREE.Group(); root.add(fxGroup);

      buildBoard();

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointerup', onPointerUp);
      window.addEventListener('resize', resize);

      resize();
      started=true;
      renderOnce();
      return true;
    }catch(e){
      console.warn('[renderGL] init failed, falling back to 2D:', e);
      try{ destroy(); }catch(_){}
      return false;
    }
  }

  function buildCamera(){
    const span=Math.max(FILES,RANKS);
    const half=span/2 + 0.7;
    camera=new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 1000);
    // camera tilt
    camera.position.set(0, span*1.6, span*0.30);
    camera.lookAt(0,0,0);
  }

  // coords
  function worldX(f){ return f-(FILES-1)/2; }
  function worldZ(r){ return (RANKS-1)/2 - r; }

  // board
  function buildBoard(){
    const lightMat=new THREE.MeshStandardMaterial({color:COL.light, roughness:0.9});
    const darkMat =new THREE.MeshStandardMaterial({color:COL.dark,  roughness:0.9});
    const tileGeo=new THREE.BoxGeometry(0.99, 0.16, 0.99);
    for(let f=0;f<FILES;f++) for(let r=0;r<RANKS;r++){
      const m=new THREE.Mesh(tileGeo, ((f+r)&1)===0?lightMat:darkMat);
      m.position.set(worldX(f), -0.08, worldZ(r));
      m.receiveShadow=true; m.userData={f,r};
      tileMeshes.push(m); boardGroup.add(m);
    }
    const rim=new THREE.Mesh(new THREE.BoxGeometry(FILES+0.5,0.3,RANKS+0.5), new THREE.MeshStandardMaterial({color:COL.rim, roughness:0.8}));
    rim.position.set(0,-0.18,0); rim.receiveShadow=true; boardGroup.add(rim);
  }

  // tokens
  const geoCache=new Map();
  function geo(key,f){ if(!geoCache.has(key)) geoCache.set(key,f()); return geoCache.get(key); }
  function geoCacheHas(g){ for(const v of geoCache.values()) if(v===g) return true; return false; }

  const glyphCache=new Map();
  function glyphTexture(type, side){
    const k=type+side; if(glyphCache.has(k)) return glyphCache.get(k);
    const S=128, c=document.createElement('canvas'); c.width=c.height=S;
    const g=c.getContext('2d'); g.clearRect(0,0,S,S);
    g.textAlign='center'; g.textBaseline='middle';
    if(type==='J'){
      // joker glyph
      g.font='84px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      g.fillText(GLYPH.J, S/2, S/2+4);
    }else{
      g.fillStyle = side==='w' ? '#23232a' : '#f1ead8';
      g.font='bold 96px "Segoe UI Symbol","Apple Symbols","Noto Sans Symbols2","DejaVu Sans",sans-serif';
      g.fillText(GLYPH[type]||type, S/2, S/2+6);
    }
    const tex=new THREE.CanvasTexture(c);
    tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=4;
    glyphCache.set(k,tex); return tex;
  }

  // procedural token
  // TODO: GLTF asset swap
  function createPieceGroup(code){
    const side=code[0], type=code[1];
    const g=new THREE.Group();
    const body=new THREE.MeshStandardMaterial({color: side==='w'?COL.ivory:COL.charcoal, roughness:0.5, metalness:0.05});

    const disc=new THREE.Mesh(geo('disc', ()=>new THREE.CylinderGeometry(0.34,0.40,0.18,40)), body);
    disc.position.y=0.09; disc.castShadow=true; disc.receiveShadow=true; g.add(disc);

    const rim=new THREE.Mesh(geo('rim', ()=>new THREE.TorusGeometry(0.345,0.035,12,40)),
      new THREE.MeshStandardMaterial({color: COL.type[type]||0x888888, roughness:0.35, metalness:0.25}));
    rim.position.y=0.185; rim.rotation.x=Math.PI/2; rim.castShadow=true; g.add(rim);

    const glyphHolder=new THREE.Group();
    glyphHolder.position.y=0.19; glyphHolder.rotation.x=-Math.PI/2; g.add(glyphHolder);
    const glyph=new THREE.Mesh(geo('glyph', ()=>new THREE.PlaneGeometry(0.56,0.56)),
      new THREE.MeshBasicMaterial({map:glyphTexture(type,side), transparent:true}));
    glyphHolder.add(glyph);

    g.userData.tintMats=[body];
    g.userData.baseCols=[body.color.clone()];
    g.userData.glyph=glyph;
    g.userData.code=code;
    return g;
  }

  function placeGroup(grp,f,r){ grp.position.set(worldX(f),0,worldZ(r)); }

  function setFrozen(grp, frozen){
    const mats=grp.userData.tintMats||[], base=grp.userData.baseCols||[];
    mats.forEach((m,i)=>{
      if(frozen){ m.color.copy(base[i]).lerp(new THREE.Color(COL.blue),0.55); m.emissive=new THREE.Color(0x16395f); m.emissiveIntensity=0.4; }
      else { if(base[i]) m.color.copy(base[i]); if(m.emissive){ m.emissive.setHex(0x000000); m.emissiveIntensity=0; } }
    });
  }

  // render / reconcile
  function render(pos, view){
    lastPos=pos; lastView=view||{};
    if(!started){ return; }
    if(previewActive){ updateHighlights(lastView); renderOnce(); return; }
    if(!pos || !pos.board){ updateHighlights(lastView); renderOnce(); return; }

    const frozen=lastView.frozen||new Set();
    const desired=new Map();
    for(let f=0;f<FILES;f++) for(let r=0;r<RANKS;r++){ const code=pos.board?.[f]?.[r]; if(code) desired.set(f+','+r, code); }

    for(const [key,entry] of [...pieceMap]){
      if(desired.get(key)!==entry.code){ pieceGroup.remove(entry.group); disposeGroup(entry.group); pieceMap.delete(key); }
    }
    for(const [key,code] of desired){
      if(!pieceMap.has(key)){ const [f,r]=key.split(',').map(Number); const grp=createPieceGroup(code); placeGroup(grp,f,r); pieceGroup.add(grp); pieceMap.set(key,{group:grp,code}); }
    }
    for(const [key,entry] of pieceMap){
      setFrozen(entry.group, frozen.has(key));
      if(entry.group.userData.glyph) entry.group.userData.glyph.rotation.z = (lastView.tableMode && entry.code[0]==='b') ? Math.PI : 0;
    }

    updateHighlights(lastView);
    renderOnce();
  }

  function flatTile(f,r,color,alpha,y=0.012,size=0.94){
    const m=new THREE.Mesh(geo('hiplane', ()=>new THREE.PlaneGeometry(1,1)),
      new THREE.MeshBasicMaterial({color, transparent:true, opacity:alpha, depthWrite:false}));
    m.scale.set(size,size,1); m.rotation.x=-Math.PI/2; m.position.set(worldX(f),y,worldZ(r));
    hiGroup.add(m); return m;
  }
  function dot(f,r){
    const m=new THREE.Mesh(geo('dot', ()=>new THREE.CircleGeometry(0.13,20)),
      new THREE.MeshBasicMaterial({color:0x2e7d32, transparent:true, opacity:0.5, depthWrite:false}));
    m.rotation.x=-Math.PI/2; m.position.set(worldX(f),0.014,worldZ(r)); hiGroup.add(m);
  }

  function updateHighlights(view){
    while(hiGroup.children.length){ const c=hiGroup.children[0]; hiGroup.remove(c); if(c.material) c.material.dispose(); }
    const lm=view.lastMove;
    if(lm){ if(Number.isInteger(lm.ff)) flatTile(lm.ff,lm.fr,COL.gold,0.28); if(Number.isInteger(lm.tf)) flatTile(lm.tf,lm.tr,COL.gold,0.28); }
    if(view.check && lastPos && lastPos.kingPos && lastPos.kingPos[lastPos.sideToMove]){
      const [kf,kr]=lastPos.kingPos[lastPos.sideToMove]; if(Number.isInteger(kf)) flatTile(kf,kr,COL.red,0.5);
    }
    if(view.legalTargets && view.legalTargets.size){ for(const key of view.legalTargets){ const [f,r]=key.split(',').map(Number); dot(f,r); } }
    if(view.sel) flatTile(view.sel.f, view.sel.r, 0xffe14d, 0.5);
  }

  // picking
  const ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
  let downXY=null, dragged=false;
  function onPointerDown(e){ downXY={x:e.clientX,y:e.clientY}; dragged=false; }
  function onPointerUp(e){
    if(downXY){ if(Math.hypot(e.clientX-downXY.x, e.clientY-downXY.y)>6) dragged=true; }
    if(dragged){ downXY=null; return; }
    downXY=null;
    const rect=canvas.getBoundingClientRect();
    ndc.x=((e.clientX-rect.left)/rect.width)*2-1;
    ndc.y=-((e.clientY-rect.top)/rect.height)*2+1;
    ray.setFromCamera(ndc,camera);
    const hits=ray.intersectObjects(tileMeshes,false);
    if(hits.length){ const {f,r}=hits[0].object.userData; if(Number.isInteger(f)&&Number.isInteger(r)) onSquareClick(f,r); }
  }

  // tween loop
  const tweens=new Set(); let ticking=false, prevT=0;
  const easeInOut=p=>p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
  const easeInCubic=p=>p*p*p;
  function ensureTicking(){ if(!ticking){ ticking=true; prevT=performance.now(); requestAnimationFrame(tick); } }
  function tick(t){ const dt=Math.min(0.05,(t-prevT)/1000); prevT=t; for(const tw of [...tweens]){ if(tw.step(dt)) tweens.delete(tw); } renderOnce(); if(tweens.size) requestAnimationFrame(tick); else ticking=false; }
  function addTween(dur, onUpdate, onDone){
    return new Promise(resolve=>{ const tw={e:0, step(dt){ this.e+=dt; let p=Math.min(1,this.e/dur); onUpdate(p); if(p>=1){ onDone&&onDone(); resolve(); return true; } return false; } }; tweens.add(tw); ensureTicking(); });
  }

  // move animation
  function animateGroupMove(group, sx,sz, ex,ez, type){
    const jumper=(type==='N'||type==='J');
    const slider=(type==='B'||type==='R'||type==='Q');
    const dur= jumper?0.5 : slider?0.46 : 0.32;
    const ease= slider? easeInCubic : easeInOut;   // sliders accelerate
    const px=-(ez-sz), pz=(ex-sx); const plen=Math.hypot(px,pz)||1;
    const bow= slider? (Math.random()*0.28) : 0;   // random swerve
    const spin= (type==='J')? Math.PI*2 : 0;
    const flip= (type==='N')? 0.7 : 0;
    return addTween(dur, (p)=>{
      const e=ease(p);
      group.position.x = sx+(ex-sx)*e + (px/plen)*Math.sin(p*Math.PI)*bow;
      group.position.z = sz+(ez-sz)*e + (pz/plen)*Math.sin(p*Math.PI)*bow;
      group.position.y = jumper? Math.sin(p*Math.PI)*0.95 : ((type==='K'||type==='P')? Math.sin(p*Math.PI)*0.13 : 0);
      if(spin) group.rotation.y=p*spin;
      if(flip) group.rotation.x=Math.sin(p*Math.PI)*flip;
    }, ()=>{
      group.position.set(ex,0,ez); group.rotation.y=0; group.rotation.x=0;
    }).then(()=> wobble(group));
  }
  function wobble(group){
    return addTween(0.34,(p)=>{
      const d=1-p, s=Math.sin(p*Math.PI*3);
      group.scale.x=1+0.20*s*d; group.scale.z=1+0.20*s*d; group.scale.y=1-0.14*s*d;
      group.rotation.z=0.12*Math.sin(p*Math.PI*4)*d;
    }, ()=>{ group.scale.set(1,1,1); group.rotation.z=0; });
  }
  function animateBack(group, ex,ez){
    const sx=group.position.x, sz=group.position.z;
    return addTween(0.28,(p)=>{ const e=easeInOut(p); group.position.x=sx+(ex-sx)*e; group.position.z=sz+(ez-sz)*e; group.position.y=Math.sin(p*Math.PI)*0.18; }, ()=>{ group.position.set(ex,0,ez); });
  }

  // preview / commit / cancel
  function previewMove(move){
    if(!started || !move) return Promise.resolve();
    try{
      const fromKey=move.ff+','+move.fr, toKey=move.tf+','+move.tr;
      const entry=pieceMap.get(fromKey);
      if(!entry) return Promise.resolve();
      previewActive=true;
      preview={ entry, fromKey, toKey, captured:null, rook:null, move };

      if(move.capture){ const cap=pieceMap.get(toKey); if(cap){ cap.group.visible=false; preview.captured=cap; } }

      const tasks=[];
      if(move.rook){
        const rfk=move.rook.ff+','+move.rook.fr, rtk=move.rook.tf+','+move.rook.tr;
        const rk=pieceMap.get(rfk);
        if(rk){ preview.rook={rk, fromKey:rfk, toKey:rtk}; tasks.push(animateGroupMove(rk.group, worldX(move.rook.ff),worldZ(move.rook.fr), worldX(move.rook.tf),worldZ(move.rook.tr), 'R')); }
      }
      tasks.push(animateGroupMove(entry.group, worldX(move.ff),worldZ(move.fr), worldX(move.tf),worldZ(move.tr), move.pc[1]));
      return Promise.all(tasks);
    }catch(e){ console.warn('[renderGL] previewMove', e); previewActive=false; preview=null; return Promise.resolve(); }
  }

  function commitPreview(move){
    if(!preview){ previewActive=false; return; }
    try{
      const {entry,fromKey,toKey,captured,rook}=preview;
      pieceMap.delete(fromKey);
      if(captured){ pieceGroup.remove(captured.group); disposeGroup(captured.group); pieceMap.delete(toKey); }
      if(rook){ pieceMap.delete(rook.fromKey); rook.rk.group.position.set(worldX(move.rook.tf),0,worldZ(move.rook.tr)); pieceMap.set(rook.toKey, rook.rk); }
      if(move.promo){
        pieceGroup.remove(entry.group); disposeGroup(entry.group);
        const np=createPieceGroup(move.pc[0]+move.promo); placeGroup(np, move.tf, move.tr); pieceGroup.add(np);
        pieceMap.set(toKey, {group:np, code:move.pc[0]+move.promo});
      }else{
        entry.group.position.set(worldX(move.tf),0,worldZ(move.tr));
        pieceMap.set(toKey, {group:entry.group, code:entry.code});
      }
    }catch(e){ console.warn('[renderGL] commitPreview', e); }
    preview=null; previewActive=false;
  }

  function cancelPreview(){
    if(!preview){ previewActive=false; return; }
    try{
      const {entry,fromKey,captured,rook,move}=preview;
      const [ff,fr]=fromKey.split(',').map(Number);
      animateBack(entry.group, worldX(ff), worldZ(fr));
      if(captured) captured.group.visible=true;
      if(rook && move.rook){ animateBack(rook.rk.group, worldX(move.rook.ff), worldZ(move.rook.fr)); }
    }catch(e){ console.warn('[renderGL] cancelPreview', e); }
    preview=null; previewActive=false;
  }

  // full animated move
  function animateMove(move){
    return previewMove(move).then(()=>commitPreview(move));
  }

  // illegal flash
  function flashIllegal(f,r){
    if(!started) return;
    const m=flatTile(f,r, 0xff2a2a, 0.0, 0.02, 0.96);
    // persist through flash
    hiGroup.remove(m); fxGroup.add(m);
    addTween(0.5,(p)=>{ m.material.opacity = (p<0.5? p*2 : (1-p)*2) * 0.6; }, ()=>{ fxGroup.remove(m); m.material.dispose(); });
  }

  // celebration
  function celebrate(winner){
    if(!started) return Promise.resolve();
    try{
      const loser= winner==='w'?'b':(winner==='b'?'w':null);
      const tasks=[];
      for(const [,entry] of pieceMap){
        const side=entry.code[0];
        if(winner && side===winner){
          const baseY=entry.group.position.y;
          tasks.push(addTween(2.6,(p)=>{ entry.group.position.y=baseY+Math.abs(Math.sin(p*Math.PI*4))*0.5; entry.group.rotation.y=Math.sin(p*Math.PI*4)*0.25; }, ()=>{ entry.group.position.y=baseY; entry.group.rotation.y=0; }));
        }else if(loser && side===loser){
          const tears=makeTears(); entry.group.add(tears);
          tasks.push(addTween(2.6,(p)=>{ entry.group.rotation.z=0.4*Math.sin(p*Math.PI); stepTears(tears,p); }, ()=>{ entry.group.rotation.z=0; entry.group.remove(tears); disposeGroup(tears); }));
        }
      }
      tasks.push(confetti());
      return Promise.all(tasks);
    }catch(e){ console.warn('[renderGL] celebrate', e); return Promise.resolve(); }
  }
  function makeTears(){
    const n=10, geom=new THREE.BufferGeometry(), pos=new Float32Array(n*3);
    for(let i=0;i<n;i++){ pos[i*3]=(Math.random()-0.5)*0.3; pos[i*3+1]=0.3+Math.random()*0.2; pos[i*3+2]=(Math.random()-0.5)*0.3; }
    geom.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(geom, new THREE.PointsMaterial({color:0x6fb7ff, size:0.07})); pts.userData.base=pos.slice(); return pts;
  }
  function stepTears(pts,p){ const a=pts.geometry.getAttribute('position'), base=pts.userData.base; for(let i=0;i<a.count;i++){ const fall=((p*2+i*0.1)%1); a.setY(i, base[i*3+1]-fall*0.5); } a.needsUpdate=true; }
  function confetti(){
    const N=240, geom=new THREE.BufferGeometry(), pos=new Float32Array(N*3), col=new Float32Array(N*3), vel=[];
    const pal=[new THREE.Color(COL.gold),new THREE.Color(COL.red),new THREE.Color(0x4dd0e1),new THREE.Color(0x9ccc65),new THREE.Color(0xffffff)];
    for(let i=0;i<N;i++){ pos[i*3]=(Math.random()-0.5)*FILES; pos[i*3+1]=Math.random()*3+span()*0.5; pos[i*3+2]=(Math.random()-0.5)*RANKS; const c=pal[(Math.random()*pal.length)|0]; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b; vel.push([(Math.random()-0.5)*0.5, -(0.8+Math.random()*1.3), (Math.random()-0.5)*0.5]); }
    geom.setAttribute('position', new THREE.BufferAttribute(pos,3)); geom.setAttribute('color', new THREE.BufferAttribute(col,3));
    const mat=new THREE.PointsMaterial({size:0.18, vertexColors:true, transparent:true, opacity:1});
    const pts=new THREE.Points(geom,mat); fxGroup.add(pts); const a=geom.getAttribute('position');
    return addTween(3.4,(p)=>{ for(let i=0;i<N;i++){ a.setX(i,a.getX(i)+vel[i][0]*0.03); a.setY(i,a.getY(i)+vel[i][1]*0.05); a.setZ(i,a.getZ(i)+vel[i][2]*0.03); if(a.getY(i)<-0.1) a.setY(i, span()*0.5+Math.random()); } a.needsUpdate=true; mat.opacity= p>0.8? (1-(p-0.8)/0.2):1; }, ()=>{ fxGroup.remove(pts); disposeGroup(pts); });
  }
  function span(){ return Math.max(FILES,RANKS); }

  // lifecycle
  function renderOnce(){ if(renderer&&scene&&camera) renderer.render(scene,camera); }

  function setDims(files,ranks){
    FILES=files||FILES; RANKS=ranks||RANKS;
    [...pieceMap.values()].forEach(e=>{ pieceGroup.remove(e.group); disposeGroup(e.group); }); pieceMap.clear();
    while(boardGroup.children.length) boardGroup.remove(boardGroup.children[0]); tileMeshes=[];
    buildBoard(); buildCamera(); resize();
    if(lastPos) render(lastPos,lastView); else renderOnce();
  }

  function resize(){
    if(!renderer||!canvas) return;
    const wrap=canvas.parentElement, rect=wrap.getBoundingClientRect();
    const s=Math.max(1, Math.min(rect.width, rect.height));
    renderer.setSize(s,s,false);
    renderOnce();
  }

  function reset(){ while(fxGroup.children.length){ const c=fxGroup.children[0]; fxGroup.remove(c); disposeGroup(c); } }

  function disposeGroup(obj){ obj.traverse?.(o=>{ if(o.geometry && !geoCacheHas(o.geometry)) o.geometry.dispose?.(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose?.()); } }); }

  function destroy(){
    try{
      window.removeEventListener('resize', resize);
      if(canvas){ canvas.removeEventListener('pointerdown', onPointerDown); canvas.removeEventListener('pointerup', onPointerUp); }
      renderer?.dispose?.();
      if(canvas && canvas.parentElement) canvas.parentElement.removeChild(canvas);
      const old=document.getElementById('board'); if(old) old.style.display='';
    }catch(_){}
    started=false;
  }

  return { kind:'gl', init, setDims, resize, render, previewMove, commitPreview, cancelPreview, animateMove, flashIllegal, celebrate, reset, destroy };
}
