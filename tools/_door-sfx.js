// Door SFX probe: trigger EV_DoDoor(normal) on a DOOM2 MAP01 door sector,
// capture what S_StartSoundAtVolume computes (distance, volume, audible),
// and whether a channel actually gets allocated.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  S_StartSound: null };
vm.createContext(ctx);
const S = (c) => vm.runInContext(c, ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
S(`G.currentMapJson = WAD.mapJson(__wad, "MAP01"); G.G_InitNew(3, 0, 1);`);

console.log(S(`(function(){
  // stand player next to a tagged door sector
  let sec = null, line = null;
  for (const ld of G.lines) if (ld.special === 1 || ld.special === 26 || ld.special === 31) { line = ld; break; }
  for (const s of G.sectors) { sec = s; break; }
  // find a door sector: tagged by some line with special 1/31/26/27/28
  const doorLine = G.lines.find(l => l.special === 1 || l.special === 31);
  const doorSec = G.sectors.find(s => s.tag === (doorLine && doorLine.tag));
  const out = { doorLine: doorLine && doorLine.linenum, tag: doorLine && doorLine.tag,
    soundorg: doorSec && doorSec.soundorg,
    soundorgUnits: doorSec ? (Math.abs(doorSec.soundorg.x) > 20000 ? 'FIXED?' : 'map-units') : '?' };
  // player at door
  const pl = G.player.mo;
  pl.x = doorSec.soundorg.x * (Math.abs(doorSec.soundorg.x) > 20000 ? 1 : 65536);
  pl.y = doorSec.soundorg.y * (Math.abs(doorSec.soundorg.y) > 20000 ? 1 : 65536);
  G.P_TeleportMove(pl, pl.x, pl.y);
  // instrument the sound entry (game.js closure — use the exported one via hook)
  let heard = [];
  const realStart = global.S_StartSound;   // host stub
  G.EV_DoDoor(doorLine, 6 /*open*/);
  const thinkers = G.liveThinkers().filter(t => t.function === G.T_VerticalDoor).length;
  out.doorThinkers = thinkers;
  out.playerPos = [Math.round(pl.x/65536), Math.round(pl.y/65536)];
  // distance as sound code would compute it (fixed-point math on raw soundorg):
  const dx = doorSec.soundorg.x - pl.x, dy = doorSec.soundorg.y - pl.y;
  out.rawDistFixed = Math.round(Math.hypot(dx, dy) / 65536);
  return JSON.stringify(out);
})()`));
