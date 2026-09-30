// Decisive: line 84 (sp102 tag3 LowerFloor) — fire from each side, run tics, diff.
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

console.log(S(`(function(){
  const l = G.lines[84];
  const out = {};
  out.sideOfWest = G.P_TeleportMove ? 'ok' : 'no';   // sanity
  // which side does the player stand on at x<128 vs x>128?
  const P = (x,y) => {
    // replicate P_PointOnLineSide
    return ((x < 128*65536 ? (l.dy > 0 ? 0 : 1) : (l.dy > 0 ? 1 : 0)));
  };
  out.sideWest = P(100*65536, 2400*65536);
  out.sideEast = P(152*65536, 2400*65536);
  out.front = G.sides[l.sidenum[0]] ? G.sectors.indexOf(G.sides[l.sidenum[0]].sector) : '?';
  out.back = G.sides[l.sidenum[1]] ? G.sectors.indexOf(G.sides[l.sidenum[1]].sector) : '?';
  out.midTex = G.sides[l.sidenum[0]].midtexture;
  return JSON.stringify(out);
})()`));

// From WEST side (x=100) press USE toward east — this should hit line 84 side 0.
console.log('west-side USE:', S(`(function(){
  const mo = G.player.mo;
  mo.x = 100*65536; mo.y = 2400*65536; mo.angle = 0;   // face east
  G.P_TeleportMove(mo, mo.x, mo.y);
  const before = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  G.P_UseLines(G.player);
  for (var i=0;i<200;i++) G.G_Ticker({forwardMove:0,sideMove:0,angleTurn:0,buttons:0});
  const after = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  return JSON.stringify({ before, after, spNow: G.lines[84].special });
})()`));

// And from EAST side (the user's side, x>128) pressing USE west.
console.log('east-side USE:', S(`(function(){
  const mo = G.player.mo;
  mo.x = 152*65536; mo.y = 2400*65536; mo.angle = 180*65536;
  G.P_TeleportMove(mo, mo.x, mo.y);
  const before = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  G.P_UseLines(G.player);
  for (var i=0;i<200;i++) G.G_Ticker({forwardMove:0,sideMove:0,angleTurn:0,buttons:0});
  const after = G.sectors.filter(s=>s.tag===3).map(s=>s.floorheight/65536);
  return JSON.stringify({ before, after, spNow: G.lines[84].special });
})()`));
