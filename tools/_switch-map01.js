// Investigate the switch in front of DOOM2 MAP01 X:214 Y:2440 Z:48 ANG:202.1.
// Places the player at the HUD coords, identifies what P_UseLines would hit,
// runs it, and diffs world state.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');

const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  localStorage: { m: new Map(), getItem(k){return this.m.has(k)?this.m.get(k):null;}, setItem(k,v){this.m.set(k,String(v));}, removeItem(k){this.m.delete(k);} },
  window: {} };
ctx.window = ctx;
vm.createContext(ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = (code) => vm.runInContext(code, ctx);

S(`G.currentMapJson = WAD.mapJson(__wad, "MAP01"); G.G_InitNew(3, 0, 1);`);

// Put the player exactly at the HUD position.
S(`(function(){
  const pl = G.player, mo = pl.mo;
  mo.x = ${214 * 65536}; mo.y = ${2440 * 65536}; mo.z = ${48 * 65536};
  mo.angle = ${Math.round(202.1 * 65536 / 360)};   // BAM units
  G.P_TeleportMove(mo, mo.x, mo.y);
})()`);

// What special lines are within reach in the facing cone?
const found = S(`(function(){
  const px = ${214*65536}, py = ${2440*65536};
  const out = [];
  G.lines.forEach(function(ld, i){
    if (!ld.special) return;
    const v1 = ld.v1, v2 = ld.v2;
    const dx = v2.x - v1.x, dy = v2.y - v1.y, L2 = dx*dx + dy*dy;
    let t = L2 ? ((px - v1.x)*dx + (py - v1.y)*dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(v1.x + t*dx - px, v1.y + t*dy - py) / 65536;
    if (d < 300) out.push({ n: i, special: ld.special, tag: ld.tag, d: Math.round(d),
      mx: Math.round((v1.x+v2.x)/2/65536), my: Math.round((v1.y+v2.y)/2/65536),
      twoSided: ld.sidenum[1] !== -1,
      s1: ld.sidenum[0] >= 0 ? G.sides[ld.sidenum[0]].texture : null });
  });
  out.sort(function(a,b){return a.d-b.d;});
  return JSON.stringify(out);
})()`);
console.log('special lines near pos:', found);

// Snapshot sectors, then actually press use the same way the game does.
const before = S(`JSON.stringify(G.sectors.map(s => [s.floorheight, s.ceilingheight]))`);
S(`G.player.cmd = {forwardMove:0, sideMove:0, angleTurn:0, buttons: G.BT_USE}; G.P_UseLines(G.player);`);
// run 120 tics so movers/thinkers do their thing
S(`for (var i=0;i<120;i++) G.G_Ticker({forwardMove:0, sideMove:0, angleTurn:0, buttons:0});`);
const after = S(`JSON.stringify(G.sectors.map(s => [s.floorheight, s.ceilingheight]))`);

const b = JSON.parse(before), a = JSON.parse(after);
const moved = [];
for (let i = 0; i < b.length; i++)
  if (b[i][0] !== a[i][0] || b[i][1] !== a[i][1])
    moved.push({ sector: i, floor: [b[i][0] / 65536, a[i][0] / 65536], ceil: [b[i][1] / 65536, a[i][1] / 65536] });
console.log('sectors that moved after USE:', JSON.stringify(moved));

// Any thinker stuck partway? (door/plat/floor mid-motion after 120 tics = 8s of work)
const thinkers = S(`JSON.stringify(G.liveThinkers().map(t => ({ fn: t.function ? (t.function.name || '?') : '?',
  floor: t.floor !== undefined ? Math.round(t.floor/65536) : undefined,
  ceiling: t.ceiling !== undefined ? Math.round(t.ceiling/65536) : undefined,
  count: t.count, speed: t.speed, type: t.type, state: t.topcount !== undefined ? 'door/plat' : undefined })).slice(0,12))`);
console.log('live thinkers after:', thinkers);

// Direct: what do line 84 (sp102 tag3) and 75 (sp103 tag4) target?
const info = S(`(function(){
  const l84 = G.lines[84], l75 = G.lines[75];
  const tagged = (tag) => G.sectors.filter(s => s.tag === tag).map(s => ({i: G.sectors.indexOf(s),
    floor: s.floorheight/65536, ceil: s.ceilingheight/65536}));
  return JSON.stringify({
    l84frontSec: l84.frontsector ? G.sectors.indexOf(l84.frontsector) : (l84.sidenum[0]>=0 ? G.sides[l84.sidenum[0]].sector.sectr ?? G.sides[l84.sidenum[0]].sector : '?'),
    tag3: tagged(3), tag4: tagged(4),
    l84special: l84.special, l75special: l75.special,
    evDoFloorType: typeof G.EV_DoFloor, evDoDoorType: typeof G.EV_DoDoor
  });
})()`);
console.log('targets:', info);

// Fire them directly like P_UseSpecialLine would
const direct = S(`(function(){
  const pl = G.player.mo;
  const r84 = G.EV_DoFloor(G.lines[84], G.lowerFloor !== undefined ? G.lowerFloor : 4);
  const th1 = G.liveThinkers().filter(t => t.function !== G.P_MobjThinker).length;
  return JSON.stringify({ evDoFloorRet: r84, nonMobjThinkers: th1 });
})()`);
console.log('direct EV_DoFloor(lowerFloor) on line84:', direct);
S(`for (var i=0;i<120;i++) G.G_Ticker({forwardMove:0, sideMove:0, angleTurn:0, buttons:0});`);
console.log('sectors after direct fire:', S(`JSON.stringify(G.sectors.map(s=>[s.floorheight,s.ceilingheight]).entries ? null : null)`));

// Trace the exact USE ray: report every add-line intersection.
S(`G.player.mo.x = ${214*65536}; G.player.mo.y = ${2440*65536};
   G.P_TeleportMove(G.player.mo, G.player.mo.x, G.player.mo.y);`);
const trace = S(`(function(){
  const mo = G.player.mo;
  const angle = mo.angle >>> 19;
  const x1 = mo.x, y1 = mo.y;
  const x2 = (x1 + (64 >> 0) * 0) | 0; // placeholder
  const USERANGE = G.USERANGE !== undefined ? G.USERANGE : 64*65536;
  const X2 = (x1 + (USERANGE >> 16) * G.finecosine[angle]) | 0;
  const Y2 = (y1 + (USERANGE >> 16) * G.finesine[angle]) | 0;
  const hits = [];
  const saved = G.P_UseSpecialLine;
  window.__useHits = [];
  const r = G.P_PathTraverse(x1, y1, X2, Y2, G.PT_ADDLINES, function(inpt){
    hits.push({ n: inpt.d === G.lines[84] ? 84 : inpt.d === G.lines[75] ? 75 : G.lines.indexOf(inpt.d),
      special: inpt.d.special, frac: inpt.isoneline !== undefined ? undefined : undefined,
      side: inpt.side });
    return true;
  });
  return JSON.stringify({ angleIdx: angle, rayEnd: [Math.round(X2/65536), Math.round(Y2/65536)],
    result: r, hits: hits.map(h=>h.n !== undefined ? h : '?') });
})()`);
console.log('use-ray trace:', trace);

// Walk to 24 units in front of line 84 midline, face it, press USE.
const close = S(`(function(){
  const mo = G.player.mo;
  // stand 24 units east of line84 midpoint (128,2400): face west (180 deg)
  mo.x = (128+24)*65536; mo.y = 2400*65536; mo.angle = 180*65536;
  G.P_TeleportMove(mo, mo.x, mo.y);
  const b = G.sectors.map(s => s.floorheight);
  G.P_UseLines(G.player);
  for (var i=0;i<200;i++) G.G_Ticker({forwardMove:0,sideMove:0,angleTurn:0,buttons:0});
  const a = G.sectors.map(s => s.floorheight);
  const moved = [];
  for (var j=0;j<b.length;j++) if (b[j]!==a[j]) moved.push([j, b[j]/65536, a[j]/65536]);
  return JSON.stringify({ moved: moved, l84specialNow: G.lines[84].special });
})()`);
console.log('close-range USE on line84:', close);

// Instrument: does the ray see ANY line? Does P_UseSpecialLine get reached?
const deep = S(`(function(){
  const mo = G.player.mo;
  mo.x = (128+24)*65536; mo.y = 2400*65536; mo.angle = 180*65536;
  G.P_TeleportMove(mo, mo.x, mo.y);
  var seen = [];
  G.P_PathTraverse(mo.x, mo.y, (mo.x - 64*65536)|0, mo.y, G.PT_ADDLINES, function(inpt){
    seen.push({ n: G.lines.indexOf(inpt.d), sp: inpt.d.special });
    return true;   // keep walking the ray
  });
  // direct dispatch
  var reached = false, threw = null;
  try { G.P_UseSpecialLine(mo, G.lines[84], 0); reached = true; } catch (e) { threw = String(e); }
  var th = G.liveThinkers().filter(t => t.function !== G.P_MobjThinker)
    .map(t => t.function && t.function.name);
  return JSON.stringify({ seenByRay: seen, directReached: reached, threw: threw, nonMobjThinkers: th });
})()`);
console.log('deep trace:', deep);
