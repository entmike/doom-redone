// Alert-sfx probe: spawn shotgun guy + zombieman, player walks into view, log S_StartSound ids.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = process.cwd();
const boot = require('./wadboot-host.js');
const ctx = vm.createContext({
  console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => {}, addEventListener: () => {},
  document: { getElementById: () => null, addEventListener: () => {}, hidden: false },
});
vm.runInContext('globalThis.window = globalThis;', ctx);
boot(ctx, 'doom1.9-retail.wad');
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/f_wipe.js', 'src/sound.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
console.log(vm.runInContext(`(function(){
  try { Snd.S_Init(); } catch(e) { return 'S_Init threw ' + e; }
  G.currentMapName = 'E1M1';
  G.currentMapJson = WAD.mapJson(__wad, 'E1M1');
  G.G_InitNew(2, 1, 1);
  // data presence for the alert sounds
  var probe = {};
  [36,37,38,39,40,41,42].forEach(function(id){
    var s = Snd._S_sfx[id];
    probe[id] = s ? { n: s.name, d: !!s.data, lk: s.link ? s.link.name : null } : 'missing';
  });
  // spawn MT_POSSESSED (3004) and MT_SERGEANT (3005) right in front of player with LOS
  var pl = G.player;
  pl.cheats |= 1;
  var px = pl.mo.x, py = pl.mo.y;
  var a = G.P_SpawnMobj(px + 128 * 65536, py, 0, 1);   // MT_POSSESSED (wall at +139)
  var b = G.P_SpawnMobj(px + 120 * 65536, py + 24 * 65536, 0, 2);   // MT_SERGEANT
  a.angle = 0x80000000 >>> 0; b.angle = 0x80000000 >>> 0;  // face west at player
  var heard = [];
  // instrument seeyou entry: does the seesound branch even run?
  G.dbgSeeyou = [];
  var origSee = G.seeyou;
  if (origSee) G.seeyou = function (a) { G.dbgSeeyou.push({ t: a.type, snd: a.info && a.info.seesound }); return origSee(a); };
  var orig = Snd.S_StartSound;
  Snd.S_StartSound = function(o, id) { heard.push({ id: id, name: Snd._S_sfx[id] ? Snd._S_sfx[id].name : '?', orig: !!o }); return orig(o, id); };
  for (var t = 0; t < 70; t++) G.G_Ticker();
  // now ask the MIXER: run addsfx+mix for both sounds, measure peak
  var peaks = {};
  [2, 38].forEach(function(id){
    Snd.S_StartSound(null, id);
    var pk = 0;
    for (var k = 0; k < 40; k++) {
      try { Snd._mix(); } catch(e) { peaks[id] = "mix threw " + e; break; }
      var mb = Snd._mixbuffer;
      for (var q = 0; q < mb.length; q++) { var v = mb[q] < 0 ? -mb[q] : mb[q]; if (v > pk) pk = v; }
    }
    if (!peaks[id]) peaks[id] = pk;
  });
  var r = JSON.stringify({
    geo: { px: px >> 16, py: py >> 16, ax: a.x >> 16, ay: a.y >> 16,
      psec: pl.mo.subsector.sector.id, asec: a.subsector && a.subsector.sector.id,
      sight: G.P_CheckSight(a, pl.mo), amb: !!(a.flags & 0x40000),
      sndTarg: a.subsector.sector.soundtarget ? a.subsector.sector.soundtarget.type : null },
    seenSectors: (G.sectorSectors ? 'has' : 'no'),
    seesounds: { poss: G.mobjinfo[1].seesound, sarg: G.mobjinfo[2].seesound },
    sfxData: probe,
    aState: a.state ? a.state.num : null, bState: b.state ? b.state.num : null,
    aTarg: !!a.target, bTarg: !!b.target,
    heard: heard, seeyou: G.dbgSeeyou, mixPeaks: peaks
  }, null, 1);
  Snd.S_StartSound = orig;
  return r;
})()`, ctx, { filename: 'alert' }));
