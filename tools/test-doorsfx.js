// Regression: sector soundorg must be fixed-point so door/plat/switch SFX
// survive S_AdjustSoundParams clipping (p_setup.c:556). Boots engine+game+
// sound headless on DOOM2 MAP01. The player stands at the door sector's
// CENTER computed from its blockbox-independent geometry (vertex bbox in
// fixed-point, recomputed here), NOT from sector.soundorg — otherwise a
// map-unit-buggy soundorg lulls the test by sitting near world origin.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
let fail = 0;
const ck = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  window: {}, localStorage: { m: new Map(), get length(){return this.m.size;}, key(i){return [...this.m.keys()][i];}, getItem(k){return this.m.has(k)?this.m.get(k):null;}, setItem(k,v){this.m.set(k,String(v));}, removeItem(k){this.m.delete(k);} } };
ctx.window = ctx;
vm.createContext(ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js', 'src/sound.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = (c) => vm.runInContext(c, ctx);
S(`Snd.S_Init();`);
S(`G.currentMapJson = WAD.mapJson(__wad, "MAP01"); G.G_InitNew(3, 0, 1);`);

// truth: bbox center of each sector's lines, fixed-point, computed INDEPENDENTLY
const truth = S(`(function(){
  const out = [];
  G.sectors.forEach(function(sec, si){
    let minx=2e9,maxx=-2e9,miny=2e9,maxy=-2e9;
    for (const l of sec.lines) {
      minx=Math.min(minx,l.v1.x,l.v2.x); maxx=Math.max(maxx,l.v1.x,l.v2.x);
      miny=Math.min(miny,l.v1.y,l.v2.y); maxy=Math.max(maxy,l.v1.y,l.v2.y);
    }
    out.push({ si, cx: ((minx+maxx)/2)|0, cy: ((miny+maxy)/2)|0,
               orgx: sec.soundorg.x, orgy: sec.soundorg.y });
  });
  return JSON.stringify(out);
})()`);
const T = JSON.parse(truth);
// all sector centers must match soundorg in fixed-point (within 1 unit)
const mism = T.filter(t => Math.abs(t.cx - t.orgx) > 65536 || Math.abs(t.cy - t.orgy) > 65536);
ck(mism.length === 0, 'every sector.soundorg equals its fixed-point bbox center (' + mism.length + ' mismatches)');

// choose the door line whose tagged sector center is FARTHEST from world
// origin — where a map-unit soundorg bug is guaranteed to clip: the buggy
// org sits at (cx_units, cy_units) while the player stands at true fixed
// (cx*65536, cy*65536) -> apparent distance ~ max(|cx|,|cy|) units >> 1200.
const door = S(`(function(){
  let best = null;
  for (const dl of G.lines) {
    if (dl.special !== 1 && dl.special !== 31 && dl.special !== 26) continue;
    const sec = G.sectors.find(s => s.tag === dl.tag);
    if (!sec) continue;
    let minx=2e9,maxx=-2e9,miny=2e9,maxy=-2e9;
    for (const l of sec.lines){ minx=Math.min(minx,l.v1.x,l.v2.x); maxx=Math.max(maxx,l.v1.x,l.v2.x);
      miny=Math.min(miny,l.v1.y,l.v2.y); maxy=Math.max(maxy,l.v1.y,l.v2.y); }
    const cx=((minx+maxx)/2)|0, cy=((miny+maxy)/2)|0;
    const d = Math.max(Math.abs(cx), Math.abs(cy));
    if (!best || d > best.d) best = { dl, sec, cx, cy, d };
  }
  return JSON.stringify({ tag: best.dl.tag, si: G.sectors.indexOf(best.sec),
    dl: G.lines.indexOf(best.dl), dUnits: Math.round(best.d / 65536),
    truthCx: [best.cx, best.cy] });
})()`);
const D = JSON.parse(door);
console.log('door line', D.dl, 'sector', D.si, 'tag', D.tag, 'center units', Math.round(D.truthCx[0]/65536), Math.round(D.truthCx[1]/65536), 'dist-from-origin', D.dUnits);

// player AT the true center (fixed-point): channel must be allocated
const near = S(`(function(){
  const pl = G.player.mo;
  pl.x = ${D.truthCx[0]}; pl.y = ${D.truthCx[1]};
  G.P_TeleportMove(pl, pl.x, pl.y);
  const sec = G.sectors[${D.si}];
  Snd.S_StopSound(sec.soundorg);
  const before = Snd.activeChannels;
  Snd.S_StartSound(sec.soundorg, 20 /*sfx_doropn*/);
  const after = Snd.activeChannels;
  Snd.S_StopSound(sec.soundorg);
  return JSON.stringify({ before, after });
})()`);
const N = JSON.parse(near);
ck(N.after > N.before, 'door sfx audible when player stands at the door (channels ' + N.before + '->' + N.after + ')');

// player 2000 units away: must be clipped by S_CLIPPING_DIST
const far = S(`(function(){
  const pl = G.player.mo;
  pl.x = ${D.truthCx[0]} + 2000 * 65536; pl.y = ${D.truthCx[1]};
  G.P_TeleportMove(pl, pl.x, pl.y);
  const sec = G.sectors[${D.si}];
  Snd.S_StopSound(sec.soundorg);
  const before = Snd.activeChannels;
  Snd.S_StartSound(sec.soundorg, 20);
  const after = Snd.activeChannels;
  Snd.S_StopSound(sec.soundorg);
  return JSON.stringify({ before, after });
})()`);
const Fa = JSON.parse(far);
ck(Fa.after === Fa.before, 'same sfx at 2000 units clipped (gospel S_CLIPPING_DIST=1200)');

// full gameplay path: press a door switch, channel allocated at the switch
const live = S(`(function(){
  const dl = G.lines[${D.dl}];
  const sec = G.sectors[${D.si}];
  const pl = G.player.mo;
  pl.x = ${D.truthCx[0]}; pl.y = ${D.truthCx[1]};
  G.P_TeleportMove(pl, pl.x, pl.y);
  Snd.S_StopSound(sec.soundorg);
  const before = Snd.activeChannels;
  G.EV_VerticalDoor(dl, pl);
  const after = Snd.activeChannels;
  return JSON.stringify({ before, after, sp: dl.special });
})()`);
const L = JSON.parse(live);
ck(L.after > L.before, 'EV_VerticalDoor press allocates audible channel at door (0->1 expected, got ' + L.before + '->' + L.after + ')');

// deterministic clipping probe: player at +1000,+1000 (inside clip range).
// Fixed-point org -> dist ~0 (audible). Map-unit org -> org=(0,0)-ish while
// player is at 1000*65536 fixed -> apparent dist ~1414 units > 1200 = silent.
// This is the exact math failure the live doors had at typical map coords.
const clip = S(`(function(){
  const sec = G.sectors[${D.si}];
  const pl = G.player.mo;
  pl.x = 1000 * 65536; pl.y = 1000 * 65536;
  G.P_TeleportMove(pl, pl.x, pl.y);
  Snd.S_StopSound(sec.soundorg);
  const before = Snd.activeChannels;
  Snd.S_StartSound(sec.soundorg, 20);
  const after = Snd.activeChannels;
  Snd.S_StopSound(sec.soundorg);
  return JSON.stringify({ before, after });
})()`);
const C = JSON.parse(clip);
ck(C.after > C.before, 'sfx at (1000,1000) vs org stays inside clip range (audible)');

console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
