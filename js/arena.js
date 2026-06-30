// 3D arena (win cinematic + game replay)
import * as THREE from 'three';

export function createArena(){
  let renderer, scene, camera, root, boardGroup, pieceGroup, fxGroup, smokeGroup;
  let FILES=9, RANKS=9, mounted=false, looping=false, prevT=0;
  const pieceMap = new Map();
  const tweens = new Set();
  const smoke = [];
  const kingFaces = [];
  let camTarget = new THREE.Vector3(0,0,0);

  const COL = {
    light:0xe7e9ef, dark:0x6c7486, rim:0x2c3242,
    ivory:0xf4ecda, charcoal:0x32333b, gold:0xffce3a, red:0xe0563f, blue:0x7fb6ff
  };
  const INIT = {
    joke:   { F:9, R:9, back:['R','N','B','Q','K','B','J','N','R'], pr:{wp:1,bp:7,wb:0,bb:8} },
    classic:{ F:8, R:8, back:['R','N','B','Q','K','B','N','R'],     pr:{wp:1,bp:6,wb:0,bb:7} }
  };

  const span = ()=>Math.max(FILES,RANKS);
  const worldX = f => f-(FILES-1)/2;
  const worldZ = r => (RANKS-1)/2 - r;
  const ease = p => p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2;

  function mount(container, opts={}){
    try{
      FILES=opts.files||9; RANKS=opts.ranks||9;
      const rect=container.getBoundingClientRect();
      const w=Math.max(1,rect.width), h=Math.max(1,rect.height);
      renderer=new THREE.WebGLRenderer({antialias:true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      renderer.setSize(w,h);
      renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);

      scene=new THREE.Scene();
      scene.fog=new THREE.Fog(0xbfe0ff, span()*1.6, span()*4.4);

      camera=new THREE.PerspectiveCamera(50, w/h, 0.1, 600);
      camera.position.set(0, span()*0.95, span()*1.35); camera.lookAt(0,0,0);

      scene.add(new THREE.HemisphereLight(0xdcefff, 0x4a5540, 0.95));
      const sun=new THREE.DirectionalLight(0xffffff,1.05);
      sun.position.set(span()*0.9, span()*1.7, span()*0.7); sun.castShadow=true;
      sun.shadow.mapSize.set(1024,1024);
      const d=span()*1.2;
      sun.shadow.camera.left=-d; sun.shadow.camera.right=d; sun.shadow.camera.top=d; sun.shadow.camera.bottom=-d;
      sun.shadow.camera.near=0.5; sun.shadow.camera.far=span()*6;
      scene.add(sun);

      root=new THREE.Group(); scene.add(root);
      boardGroup=new THREE.Group(); root.add(boardGroup);
      pieceGroup=new THREE.Group(); root.add(pieceGroup);
      fxGroup=new THREE.Group(); root.add(fxGroup);
      smokeGroup=new THREE.Group(); root.add(smokeGroup);

      buildSky(); buildGround(); buildBoard(); buildSmoke();

      window.addEventListener('resize', resize);
      mounted=true; startLoop();
      return true;
    }catch(e){ console.warn('[arena] mount failed', e); try{destroy();}catch(_){}; return false; }
  }

  // scenery
  function buildSky(){
    const c=document.createElement('canvas'); c.width=8; c.height=256;
    const g=c.getContext('2d'); const grad=g.createLinearGradient(0,0,0,256);
    grad.addColorStop(0,'#2f74d0'); grad.addColorStop(0.55,'#86b9ef'); grad.addColorStop(1,'#dcefff');
    g.fillStyle=grad; g.fillRect(0,0,8,256);
    const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
    const sky=new THREE.Mesh(new THREE.SphereGeometry(span()*6,24,16), new THREE.MeshBasicMaterial({map:tex, side:THREE.BackSide, fog:false}));
    scene.add(sky);
  }
  function buildGround(){
    const m=new THREE.Mesh(new THREE.CircleGeometry(span()*5, 48),
      new THREE.MeshStandardMaterial({color:0x4f7a43, roughness:1}));
    m.rotation.x=-Math.PI/2; m.position.y=-0.6; m.receiveShadow=true; scene.add(m);
  }
  function buildBoard(){
    const lightMat=new THREE.MeshStandardMaterial({color:COL.light, roughness:0.7});
    const darkMat =new THREE.MeshStandardMaterial({color:COL.dark,  roughness:0.7});
    const tileGeo=new THREE.BoxGeometry(0.98,0.22,0.98);
    for(let f=0;f<FILES;f++) for(let r=0;r<RANKS;r++){
      const m=new THREE.Mesh(tileGeo, ((f+r)&1)===0?lightMat:darkMat);
      m.position.set(worldX(f),-0.11,worldZ(r)); m.receiveShadow=true; boardGroup.add(m);
    }
    const base=new THREE.Mesh(new THREE.BoxGeometry(FILES+0.7,0.5,RANKS+0.7),
      new THREE.MeshStandardMaterial({color:COL.rim, roughness:0.6}));
    base.position.y=-0.36; base.receiveShadow=true; boardGroup.add(base);
  }
  function smokeTexture(){
    const S=64,c=document.createElement('canvas'); c.width=c.height=S;
    const g=c.getContext('2d'); const grd=g.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
    grd.addColorStop(0,'rgba(220,220,225,0.9)'); grd.addColorStop(1,'rgba(220,220,225,0)');
    g.fillStyle=grd; g.fillRect(0,0,S,S);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
  }
  function buildSmoke(){
    const tex=smokeTexture();
    for(let i=0;i<14;i++){
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, opacity:0.0, depthWrite:false, color:0x9aa0a8}));
      const edge=(Math.random()<0.5?-1:1);
      s.position.set((Math.random()-0.5)*(FILES+3), 0.2+Math.random()*1.5, edge*(RANKS*0.5+0.5+Math.random()*2));
      const sc=1.2+Math.random()*2.2; s.scale.set(sc,sc,sc);
      s.userData={base:s.position.y, sp:0.3+Math.random()*0.5, ph:Math.random()*6.28, max:0.45*Math.random()+0.2};
      smoke.push(s); smokeGroup.add(s);
    }
  }
  function stepSmoke(dt,t){
    for(const s of smoke){
      s.position.y += s.userData.sp*dt;
      if(s.position.y > s.userData.base+3){ s.position.y=s.userData.base; }
      const k=(s.position.y-s.userData.base)/3;
      s.material.opacity = s.userData.max * Math.sin(k*Math.PI);
      s.position.x += Math.sin(t*0.4+s.userData.ph)*0.004;
    }
  }

  // pieces
  const geoCache=new Map();
  function geo(k,f){ if(!geoCache.has(k)) geoCache.set(k,f()); return geoCache.get(k); }
  function lathe(k,pts,seg=20){ return geo(k,()=>new THREE.LatheGeometry(pts.map(p=>new THREE.Vector2(p[0],p[1])),seg)); }
  function bodyMat(side){ return new THREE.MeshStandardMaterial({color:side==='w'?COL.ivory:COL.charcoal, roughness:0.5, metalness:0.05}); }
  function accent(hex){ return new THREE.MeshStandardMaterial({color:hex, roughness:0.4, metalness:0.2}); }

  function createPiece(code){
    const side=code[0], type=code[1];
    const g=new THREE.Group();
    const body=bodyMat(side);
    const add=m=>{ m.castShadow=true; g.add(m); return m; };
    const sph=(r,m)=>new THREE.Mesh(geo('s'+r,()=>new THREE.SphereGeometry(r,16,12)), m);

    if(type==='P'){
      add(new THREE.Mesh(lathe('P',[[0,0],[0.30,0],[0.30,0.05],[0.15,0.10],[0.12,0.30],[0.19,0.34],[0.09,0.38]]), body));
      const h=sph(0.17,body); h.position.y=0.5; add(h);
    }else if(type==='R'){
      add(new THREE.Mesh(lathe('R',[[0,0],[0.32,0],[0.32,0.06],[0.18,0.12],[0.18,0.46],[0.26,0.5],[0.26,0.6]]), body));
      for(let i=0;i<6;i++){ const b=new THREE.Mesh(geo('rc',()=>new THREE.BoxGeometry(0.09,0.12,0.09)),body); const a=i/6*6.283; b.position.set(Math.cos(a)*0.2,0.66,Math.sin(a)*0.2); add(b); }
    }else if(type==='B'){
      add(new THREE.Mesh(lathe('B',[[0,0],[0.30,0],[0.30,0.05],[0.14,0.12],[0.11,0.4],[0.2,0.5],[0.06,0.62],[0.1,0.7]]), body));
      const h=sph(0.1,body); h.position.y=0.78; add(h);
    }else if(type==='N'){
      add(new THREE.Mesh(lathe('Nb',[[0,0],[0.31,0],[0.31,0.06],[0.18,0.12],[0.16,0.22]]), body));
      const neck=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.34,0.16),body); neck.position.set(0,0.36,(side==='w'?-0.02:0.02)); neck.rotation.x=(side==='w'?-0.28:0.28); add(neck);
      const head=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.16,0.3),body); head.position.set(0,0.56,(side==='w'?0.08:-0.08)); add(head);
      const snout=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.12,0.16),body); snout.position.set(0,0.52,(side==='w'?0.24:-0.24)); add(snout);
    }else if(type==='Q'){
      add(new THREE.Mesh(lathe('Q',[[0,0],[0.33,0],[0.33,0.06],[0.16,0.14],[0.12,0.55],[0.22,0.66],[0.18,0.74]]), body));
      const cm=accent(COL.gold);
      for(let i=0;i<7;i++){ const a=i/7*6.283; const pt=new THREE.Mesh(geo('qp',()=>new THREE.SphereGeometry(0.06,10,8)),cm); pt.position.set(Math.cos(a)*0.17,0.82,Math.sin(a)*0.17); add(pt); }
      const top=sph(0.08,cm); top.position.y=0.88; add(top);
    }else if(type==='K'){
      add(new THREE.Mesh(lathe('K',[[0,0],[0.34,0],[0.34,0.06],[0.17,0.14],[0.13,0.6],[0.24,0.72],[0.2,0.8]]), body));
      const cm=accent(COL.gold);
      const v=new THREE.Mesh(geo('kv',()=>new THREE.BoxGeometry(0.07,0.26,0.07)),cm); v.position.y=0.98; add(v);
      const hb=new THREE.Mesh(geo('kh',()=>new THREE.BoxGeometry(0.2,0.07,0.07)),cm); hb.position.y=0.98; add(hb);
      attachFace(g, 0.62);
    }else if(type==='J'){
      add(new THREE.Mesh(lathe('Jb',[[0,0],[0.30,0],[0.30,0.05],[0.14,0.12],[0.12,0.34],[0.22,0.42],[0.1,0.46]]), body));
      const head=sph(0.17, bodyMat(side)); head.position.y=0.58; add(head);
      const caps=[COL.red,COL.gold,COL.red], pos=[[-0.16,0.7,0],[0,0.8,0],[0.16,0.7,0]], tl=[0.5,0,-0.5];
      pos.forEach((p,i)=>{ const cone=new THREE.Mesh(geo('Jc',()=>new THREE.ConeGeometry(0.07,0.22,10)),accent(caps[i])); cone.position.set(p[0],p[1],p[2]); cone.rotation.z=tl[i]; add(cone);
        const bell=new THREE.Mesh(geo('Jbe',()=>new THREE.SphereGeometry(0.045,8,8)),accent(COL.gold)); bell.position.set(p[0]+Math.sin(tl[i])*0.13,p[1]+0.13,p[2]); add(bell); });
    }else{ add(sph(0.22,body)); }

    g.userData.code=code; g.userData.side=side;
    return g;
  }

  // king faces
  function faceTexture(mood){
    const S=128,c=document.createElement('canvas'); c.width=c.height=S;
    const g=c.getContext('2d'); g.clearRect(0,0,S,S);
    g.fillStyle='#1c1c22'; g.lineWidth=6; g.strokeStyle='#1c1c22';
    const eye=(x,y)=>{ g.beginPath(); g.arc(x,y,9,0,6.283); g.fill(); };
    if(mood==='cry'){
      g.beginPath(); g.arc(44,52,12,Math.PI,0); g.stroke();
      g.beginPath(); g.arc(84,52,12,Math.PI,0); g.stroke();
      g.beginPath(); g.arc(64,92,16,Math.PI,0); g.stroke();
      g.fillStyle='#49b0ff';
      g.beginPath(); g.arc(40,70,6,0,6.283); g.fill(); g.beginPath(); g.arc(88,70,6,0,6.283); g.fill();
    }else if(mood==='worried'){
      eye(44,54); eye(84,54);
      g.beginPath(); g.moveTo(34,40); g.lineTo(54,48); g.moveTo(94,40); g.lineTo(74,48); g.stroke();
      g.beginPath(); g.arc(64,90,14,0.15*Math.PI,0.85*Math.PI); g.stroke();
    }else if(mood==='smile'){
      eye(44,54); eye(84,54);
      g.beginPath(); g.arc(64,80,18,0,Math.PI); g.stroke();
    }else{
      eye(44,54); eye(84,54);
      g.beginPath(); g.moveTo(48,86); g.lineTo(80,86); g.stroke();
    }
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
  }
  function attachFace(g, y){
    const mat=new THREE.MeshBasicMaterial({map:faceTexture('neutral'), transparent:true});
    const face=new THREE.Mesh(new THREE.PlaneGeometry(0.34,0.34), mat);
    face.position.set(0,y,0.001); g.add(face);
    g.userData.face=face; kingFaces.push(face);
  }
  function setFace(entry, mood){
    const f=entry && entry.group.userData.face;
    if(f){ f.material.map=faceTexture(mood); f.material.needsUpdate=true; }
  }
  function billboardFaces(){
    for(const f of kingFaces){ f.getWorldPosition(_v); f.lookAt(camera.position.x, _v.y, camera.position.z); }
  }
  const _v=new THREE.Vector3();

  // placement / position
  function place(grp,f,r){ grp.position.set(worldX(f),0,worldZ(r)); }
  function clearPieces(){ for(const e of pieceMap.values()){ pieceGroup.remove(e.group); dispose(e.group); } pieceMap.clear(); kingFaces.length=0; }
  function setBoard(board){
    clearPieces();
    for(let f=0;f<FILES;f++) for(let r=0;r<RANKS;r++){
      const code=board?.[f]?.[r]; if(!code) continue;
      const g=createPiece(code); place(g,f,r); pieceGroup.add(g); pieceMap.set(f+','+r,{group:g,code});
    }
    renderOnce();
  }
  function initialBoard(mode){
    const cfg=INIT[mode==='classic'?'classic':'joke'];
    FILES=cfg.F; RANKS=cfg.R;
    const b=Array.from({length:FILES},()=>Array(RANKS).fill(null));
    for(let f=0;f<FILES;f++){ b[f][cfg.pr.wb]='w'+cfg.back[f]; b[f][cfg.pr.bb]='b'+cfg.back[f]; b[f][cfg.pr.wp]='wP'; b[f][cfg.pr.bp]='bP'; }
    return b;
  }

  // tween loop
  function startLoop(){ if(!looping){ looping=true; prevT=performance.now(); requestAnimationFrame(loop); } }
  function loop(t){
    if(!mounted) { looping=false; return; }
    const dt=Math.min(0.05,(t-prevT)/1000); prevT=t;
    for(const tw of [...tweens]){ if(tw.step(dt)) tweens.delete(tw); }
    stepSmoke(dt, t/1000);
    billboardFaces();
    renderOnce();
    requestAnimationFrame(loop);
  }
  function tween(dur,onUpdate,onDone){
    return new Promise(res=>{ const tw={e:0,step(dt){ this.e+=dt; const p=Math.min(1,this.e/dur); onUpdate(p); if(p>=1){ onDone&&onDone(); res(); return true; } return false; }}; tweens.add(tw); startLoop(); });
  }
  const wait = s => tween(s,()=>{});

  function camTo(pos, look, dur){
    const p0=camera.position.clone(), l0=camTarget.clone();
    return tween(dur,(p)=>{ const t=ease(p); camera.position.lerpVectors(p0,pos,t); camTarget.lerpVectors(l0,look,t); camera.lookAt(camTarget); });
  }

  // tears
  function addTears(entry){
    const n=12, gm=new THREE.BufferGeometry(), pos=new Float32Array(n*3);
    for(let i=0;i<n;i++){ pos[i*3]=(Math.random()-0.5)*0.3; pos[i*3+1]=0.5+Math.random()*0.2; pos[i*3+2]=0.12+Math.random()*0.1; }
    gm.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(gm,new THREE.PointsMaterial({color:0x6fb7ff,size:0.07})); pts.userData.base=pos.slice();
    entry.group.add(pts);
    tween(2.4,(p)=>{ const a=pts.geometry.getAttribute('position'); for(let i=0;i<a.count;i++){ const fall=((p*2+i*0.1)%1); a.setY(i, pts.userData.base[i*3+1]-fall*0.55); } a.needsUpdate=true; }, ()=>{ entry.group.remove(pts); dispose(pts); });
  }

  // win cinematic
  async function playWin(mate, winner){
    if(!mounted) return;
    try{
      const loser= winner==='w'?'b':'w';
      const king = (mate.kingSq && Number.isInteger(mate.kingSq[0])) ? pieceMap.get(mate.kingSq[0]+','+mate.kingSq[1]) : null;
      const atk  = pieceMap.get(mate.pieceF+','+mate.pieceR);
      // sweep establishing shot
      await camTo(new THREE.Vector3(0, span()*0.8, span()*1.25), new THREE.Vector3(0,0.3,0), 0.8);
      if(king){
        const kp=king.group.position.clone();
        await camTo(new THREE.Vector3(kp.x*0.6, span()*0.42, kp.z+span()*0.7), new THREE.Vector3(kp.x,0.5,kp.z), 0.9);
        setFace(king,'worried');
        await tween(0.5,(p)=>{ king.group.rotation.z=Math.sin(p*30)*0.05*(1-p); });
      }
      if(atk && king){
        const s=atk.group.position.clone(), e=king.group.position.clone();
        await tween(0.95,(p)=>{ const t=ease(p); atk.group.position.set(s.x+(e.x-s.x)*t, Math.sin(p*Math.PI)*span()*0.45, s.z+(e.z-s.z)*t); atk.group.rotation.y=p*Math.PI*4; });
        setFace(king,'cry'); addTears(king);
        await tween(0.6,(p)=>{ king.group.rotation.z=-1.3*ease(p); king.group.position.y=-0.05*ease(p); });
      }
      await wait(0.7);
    }catch(e){ console.warn('[arena] playWin', e); }
  }

  // replay
  function beginPlayback(mode){
    setBoard(initialBoard(mode));
    camTo(new THREE.Vector3(0, span()*1.0, span()*1.35), new THREE.Vector3(0,0,0), 0.6);
  }
  async function step(e){
    if(!mounted || !e) return;
    try{
      const fk=e.ff+','+e.fr, tk=e.tf+','+e.tr;
      const mv=pieceMap.get(fk); if(!mv) return;
      // camera angle for this move
      const mx=(worldX(e.ff)+worldX(e.tf))/2, mz=(worldZ(e.fr)+worldZ(e.tr))/2;
      const side=((e.ff+e.tf)%2===0)?1:-1;
      await camTo(new THREE.Vector3(mx+side*span()*0.5, span()*0.7, mz+span()*0.85), new THREE.Vector3(mx,0.3,mz), 0.5);
      // capture
      if(e.capture){ const cap=pieceMap.get(tk); if(cap){ pieceMap.delete(tk); await tween(0.25,(p)=>{ cap.group.scale.setScalar(Math.max(0.001,1-p)); cap.group.rotation.z=p; }); pieceGroup.remove(cap.group); dispose(cap.group); } }
      // castle rook
      if(e.rook){ const rk=pieceMap.get(e.rook.ff+','+e.rook.fr); if(rk){ pieceMap.delete(e.rook.ff+','+e.rook.fr); const rs=rk.group.position.clone(), re=new THREE.Vector3(worldX(e.rook.tf),0,worldZ(e.rook.tr)); tween(0.5,(p)=>{ rk.group.position.lerpVectors(rs,re,ease(p)); }, ()=>{ rk.group.position.copy(re); pieceMap.set(e.rook.tf+','+e.rook.tr, rk); }); } }
      // mover
      pieceMap.delete(fk);
      const s=mv.group.position.clone(), en=new THREE.Vector3(worldX(e.tf),0,worldZ(e.tr));
      const hop=(e.pc&&(e.pc[1]==='N'||e.pc[1]==='J'))?span()*0.18:0.12;
      await tween(0.55,(p)=>{ mv.group.position.lerpVectors(s,en,ease(p)); mv.group.position.y=Math.sin(p*Math.PI)*hop; }, ()=>{ mv.group.position.copy(en); });
      if(e.promo){ pieceGroup.remove(mv.group); dispose(mv.group); const np=createPiece(e.pc[0]+e.promo); place(np,e.tf,e.tr); pieceGroup.add(np); pieceMap.set(tk,{group:np,code:e.pc[0]+e.promo}); }
      else pieceMap.set(tk,{group:mv.group,code:mv.code});
    }catch(err){ console.warn('[arena] step', err); }
  }

  // lifecycle
  function renderOnce(){ if(renderer&&scene&&camera) renderer.render(scene,camera); }
  function resize(){
    if(!renderer) return;
    const wrap=renderer.domElement.parentElement; if(!wrap) return;
    const rect=wrap.getBoundingClientRect(); const w=Math.max(1,rect.width), h=Math.max(1,rect.height);
    renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix(); renderOnce();
  }
  function dispose(obj){ obj.traverse?.(o=>{ if(o.geometry && !cached(o.geometry)) o.geometry.dispose?.(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ m.map?.dispose?.(); m.dispose?.(); }); } }); }
  function cached(g){ for(const v of geoCache.values()) if(v===g) return true; return false; }
  function destroy(){
    mounted=false; looping=false;
    try{ window.removeEventListener('resize', resize); renderer?.dispose?.(); const el=renderer?.domElement; if(el&&el.parentElement) el.parentElement.removeChild(el); }catch(_){}
  }

  return { mount, setBoard, playWin, beginPlayback, step, resize, destroy };
}
