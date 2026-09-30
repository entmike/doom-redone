// Instrument P_PathTraverse internals for the exact USE ray from (152,2400) W,
// and trace the T_MoveFloor mover to completion.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  localStorage: { m: new Map(), getItem(k){return this.m.has(k)?this.m.get(k):null;}, setItem(k,v){this.m.set(k,String(v));}, removeItem(k){this.m.delete(k);} } };
ctx.window = ctx;
vm.createContext(ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = (c) => vm.runInContext(c, ctx);
S(`G.currentMapJson = WAD.mapJson(__wad, "MAP01"); G.G_InitNew(3, 0, 1);`);

// Replay the USE ray step-by-step: which cells walked, intercepts found.
console.log(S(`(function(){
  const mo = G.player.mo;
  mo.x = 152*65536; mo.y = 2400*65536; mo.angle = 180*65536;
  G.P_TeleportMove(mo, mo.x, mo.y);
  const FU = 65536;
  const l = G.lines[84];
  const trace = { x: mo.x, y: mo.y, dx: -64*FU, dy: 0 };
  // PIT logic replicated from game.js for line84
  const s1 = G.P_PointOnLineSide ? 0 : null;   // not exported; compute C-style
  function ptOnSide(x, y, line) {
    let dx, dy, left, right;
    if (!line.dx) { if (x <= line.v1.x) return line.dy > 0 ? 1 : 0; return line.dy < 0 ? 1 : 0; }
    if (!line.dy) { if (y <= line.v1.y) return line.dx < 0 ? 1 : 0; return line.dx > 0 ? 1 : 0; }
    dx = (x - line.v1.x) | 0; dy = (y - line.v1.y) | 0;
    if (((line.dy ^ line.dx ^ dx ^ dy) & 0x80000000)) {
      return ((line.dy ^ dx) & 0x80000000) ? 1 : 0;
    }
    left = G.FixedMul(line.dy >> 8, dx >> 8);
    right = G.FixedMul(dy >> 8, line.dx >> 8);
    return right < left ? 0 : 1;
  }
  const A = ptOnSide(trace.x, trace.y, l);
  const B = ptOnSide(trace.x + trace.dx, trace.y + trace.dy, l);
  // blockmap cells the ray walks
  const bm = G.mapdata.blockmap;
  const orgx = bm.bmaporgx ?? bm.orgx, orgy = bm.bmaporgy ?? bm.orgy;
  const xt1 = (mo.x - orgx) >> 23, yt1 = (mo.y - orgy) >> 23;
  const xt2 = (mo.x - 64*FU - orgx) >> 23, yt2 = yt1;
  return JSON.stringify({ ldx: l.dx, ldy: l.dy, sideAtStart: A, sideAtEnd: B,
    sameSide: A === B, cells: [[xt1,yt1],[xt2,yt2]],
    ptOnSideExported: typeof G.P_PointOnLineSide });
})()`));

// Fire directly and trace mover to completion over many tics.
console.log(S(`(function(){
  const mo = G.player.mo;
  mo.x = 152*65536; mo.y = 2400*65536; mo.angle = 180*65536;
  G.P_TeleportMove(mo, mo.x, mo.y);
  G.P_UseSpecialLine(mo, G.lines[84], 1);   // side 1 = east side (player's side)
  const movers = G.liveThinkers().filter(t => t.function === G.T_MoveFloor);
  const m0 = movers.map(t => ({ sec: G.sectors.indexOf(t.sector),
    floor: t.floor !== undefined ? t.floor/65536 : undefined,
    top: t.topfloor !== undefined ? t.topfloor/65536 : undefined,
    bottom: t.bottompos !== undefined ? t.bottompos/65536 : undefined,
    dir: t.dir, speed: t.speed/65536, count: t.count, type: t.type }));
  for (var i=0;i<400;i++) G.G_Ticker({forwardMove:0,sideMove:0,angleTurn:0,buttons:0});
  const tag3 = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  return JSON.stringify({ moversAtFire: m0, tag3After400: tag3, spNow: G.lines[84].special });
})()`));

console.log(S(`(function(){
  const r = G.EV_DoFloor(G.lines[84], 4 /*lowerFloor?*/);
  const mv = G.liveThinkers().filter(t => t.function === G.T_MoveFloor);
  const snap = mv.map(t => ({ keys: Object.keys(t).slice(0,14),
    floor: t.floor/65536, top: (t.topfloor!==undefined?t.topfloor:t.top)/65536,
    bottom: (t.bottompos!==undefined?t.bottompos:t.bottom)/65536,
    dir: t.direction !== undefined ? t.direction : t.dir, speed: t.speed/65536,
    sec: G.sectors.indexOf(t.sector) }));
  const b = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  for (var i=0;i<400;i++) G.G_Ticker({forwardMove:0,sideMove:0,angleTurn:0,buttons:0});
  const a = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  return JSON.stringify({ evRet: r, movers: snap, before: b, after: a });
})()`));

console.log(S(`(function(){
  // what SWITCH-textured special line sits in the sight line from (214,2440) @202.1deg?
  const px = 214*65536, py = 2440*65536;
  const ang = Math.round(202.1*65536/360);
  const c = G.finecosine[(ang>>>19)&8191], s = G.finesine[(ang>>>19)&8191];
  const isSwitch = (tx) => { if (!tx) return false;
    const name = (G.texNames && G.texNames[tx]) || (ASSETS && ASSETS.texturenames ? ASSETS.texturenames[tx] : null);
    return name ? /^SW[12]/.test(name) : false; };
  const out = [];
  G.lines.forEach(function(ld, i){
    const v1 = ld.v1, v2 = ld.v2;
    const dx = v2.x - v1.x, dy = v2.y - v1.y, L2 = dx*dx + dy*dy;
    let t = L2 ? ((px - v1.x)*dx + (py - v1.y)*dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(v1.x + t*dx - px, v1.y + t*dy - py) / 65536;
    if (d > 400) return;
    const sw = [0,1].map(k => ld.sidenum[k] >= 0 ? (isSwitch(G.sides[ld.sidenum[k]].toptexture) ? 'top' : isSwitch(G.sides[ld.sidenum[k]].midtexture) ? 'mid' : isSwitch(G.sides[ld.sidenum[k]].bottomtexture) ? 'bot' : null) : null);
    if (ld.special || sw.some(Boolean)) out.push({ i, sp: ld.special, tag: ld.tag, d: Math.round(d),
      mid: [Math.round((v1.x+v2.x)/2/65536), Math.round((v1.y+v2.y)/2/65536)], sw: sw });
  });
  out.sort((a,b)=>a.d-b.d);
  return JSON.stringify(out);
})()`));

console.log(S(`(function(){
  const names = Object.keys(G.ASSETS.textures);
  const inList = (t) => t ? { name: names[t] } : 'noTex';
  const s75 = G.sides[G.lines[75].sidenum[0]], s84 = G.sides[G.lines[84].sidenum[0]];
  const b = G.player.mo;
  // also: what does P_UseLines ACTUALLY hit now (exported traverser wrapper)?
  return JSON.stringify({
    l84: { top: inList(s84.toptexture), mid: inList(s84.midtexture), bot: inList(s84.bottomtexture) },
    l75: { top: inList(s75.toptexture), mid: inList(s75.midtexture), bot: inList(s75.bottomtexture) },
    texCount: names.length
  });
})()`));

console.log(S(`(function(){
  // replay USE ray with CORRECT flags literal (PT_ADDLINES = 1)
  const mo = G.player.mo;
  function ray(x,y,angBAM,label){
    mo.x = x; mo.y = y; mo.angle = angBAM;
    G.P_TeleportMove(mo, x, y);
    const hits = [];
    const angle = mo.angle >>> 19;
    const X2 = (x + 64 * G.finecosine[angle]) | 0;
    const Y2 = (y + 64 * G.finesine[angle]) | 0;
    const r = G.P_PathTraverse(x, y, X2, Y2, 1, function(inpt){
      hits.push({ n: G.lines.indexOf(inpt.d), sp: inpt.d.special });
      return true;
    });
    return { label, result: r, hits };
  }
  const A = ray(152*65536, 2400*65536, 180*65536, 'east-of-line84 facing W');
  const B = ray(100*65536, 2400*65536, 0, 'west-of-line84 facing E');
  const C = ray(214*65536, 2440*65536, Math.round(202.1*65536/360), 'user spot @202.1');
  return JSON.stringify([A,B,C]);
})()`));

console.log(S(`(function(){
  const mo = G.player.mo;
  const FU = 65536;
  function ray(x,y,angBAM,len,label){
    mo.x = x; mo.y = y; mo.angle = angBAM;
    G.P_TeleportMove(mo, x, y);
    const hits = [];
    const angle = mo.angle >>> 19;
    const X2 = (x + len * G.finecosine[angle]) | 0;
    const Y2 = (y + len * G.finesine[angle]) | 0;
    G.P_PathTraverse(x, y, X2, Y2, 1, function(inpt){
      hits.push({ n: G.lines.indexOf(inpt.d), sp: inpt.d.special });
      return true;
    });
    return { label, hits };
  }
  const off = ray(150*FU, 2400*FU, 180*FU, 22*FU, 'off-boundary east, W, in-range');
  const on  = ray(152*FU, 2400*FU, 180*FU, 24*FU, 'ON-boundary x=152, W, in-range');
  const user = ray(214*FU, 2440*FU, Math.round(202.1*65536/360), 64*FU, 'user spot full USERANGE');
  return JSON.stringify([off, on, user]);
})()`));

console.log(S(`(function(){
  const mo = G.player.mo, FU = 65536;
  const DEG = 4294967296/360;
  function press(x, y, deg, ticks) {
    mo.x = x*FU; mo.y = y*FU; mo.angle = Math.round(deg*DEG) >>> 0;
    G.P_TeleportMove(mo, mo.x, mo.y);
    const b = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
    G.P_UseLines(G.player);
    for (var i=0;i<(ticks||200);i++) G.G_Ticker({forwardMove:0,sideMove:0,angleTurn:0,buttons:0});
    const a = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
    return { pos: [x,y], facing: deg, floorBefore: b[0], floorAfter: a[0],
             spNow: G.lines[84].special, changed: b[0] !== a[0] };
  }
  const R = [];
  R.push(press(152, 2400, 180, 300));      // east of switch, face west (correct angle)
  R.push(press(100, 2400, 0, 300));        // west of switch, face east (wrong side per gospel)
  R.push(press(214, 2440, 202.1, 300));    // user's exact spot + facing
  return JSON.stringify(R);
})()`));
